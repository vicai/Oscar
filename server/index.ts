import express, { type Request, type Response } from 'express'
import { Chess } from 'chess.js'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { authenticateAccount, createGuestAccount, createSessionForAccount, getAuthenticatedAccount, registerAccount, signOut } from './auth.js'
import { createCheckoutUrl, createPortalUrl, constructStripeEvent, isBillingConfigured, applyStripeSubscriptionUpdate } from './billing.js'
import { analyzePosition, chooseEngineMove } from './engine.js'
import { consumeGameStart, buildAccessState } from './entitlements.js'
import {
  getOpeningById,
  listOpenings,
  resolveOpeningProgress,
} from './openings.js'
import {
  createGame,
  createUser,
  getAccountById,
  getGame,
  getUser,
  listUsersForAccount,
  updateGame,
  updateUser,
} from './store.js'
import { isSupabaseConfigured } from './supabase.js'
import type {
  AccountRecord,
  GameMode,
  GameRecord,
  GameResult,
  GameStatus,
  MoveEntry,
  PlayerColor,
  TimeControlPreset,
  UserRecord,
} from './types.js'

const app = express()
const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'
const projectRoot = process.cwd()
const distDir = resolve(projectRoot, 'dist')
const indexFile = resolve(distDir, 'index.html')
const dataDirectory = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(projectRoot, 'data')

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (request, response) => {
    try {
      const signature = request.headers['stripe-signature']
      if (typeof signature !== 'string') {
        response.status(400).json({ error: 'Missing Stripe signature.' })
        return
      }

      const event = constructStripeEvent(request.body as Buffer, signature)

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object
        const accountId =
          typeof session.metadata?.accountId === 'string'
            ? session.metadata.accountId
            : typeof session.client_reference_id === 'string'
              ? session.client_reference_id
              : ''

        if (accountId) {
          await applyStripeSubscriptionUpdate(accountId, {
            plan: 'premium',
            subscriptionStatus: 'active',
            stripeCustomerId:
              typeof session.customer === 'string' ? session.customer : null,
            stripeSubscriptionId:
              typeof session.subscription === 'string' ? session.subscription : null,
          })
        }
      }

      if (
        event.type === 'customer.subscription.updated' ||
        event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.deleted'
      ) {
        const subscription = event.data.object
        const accountId =
          typeof subscription.metadata?.accountId === 'string'
            ? subscription.metadata.accountId
            : ''
        if (accountId) {
          const status =
            subscription.status === 'active' || subscription.status === 'trialing'
              ? subscription.status
              : subscription.status === 'past_due'
                ? 'past_due'
                : 'canceled'
          await applyStripeSubscriptionUpdate(accountId, {
            plan: status === 'active' || status === 'trialing' ? 'premium' : 'free',
            subscriptionStatus: status,
            stripeCustomerId:
              typeof subscription.customer === 'string' ? subscription.customer : null,
            stripeSubscriptionId: subscription.id,
          })
        }
      }

      response.json({ received: true })
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Webhook failed.',
      })
    }
  },
)

app.use(express.json())

app.get('/healthz', (_request, response) => {
  response.status(200).json({
    ok: true,
    port,
    dataDir: dataDirectory,
    supabaseConfigured: isSupabaseConfigured(),
    billingConfigured: isBillingConfigured(),
  })
})

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function buildMoveEntry(
  actor: 'human' | 'ai',
  move: { san: string; from: string; to: string },
  ply: number,
): MoveEntry {
  return {
    actor,
    san: move.san,
    from: move.from,
    to: move.to,
    ply,
  }
}

function calculateRatingDelta(currentRating: number, result: Exclude<GameResult, null>) {
  const ratio = (clamp(currentRating, 100, 3200) - 100) / 3100

  if (result === 'human_win') {
    return Math.round(48 - ratio * 18)
  }

  if (result === 'ai_win') {
    return -Math.round(32 + ratio * 18)
  }

  if (ratio < 0.35) {
    return 10
  }

  if (ratio > 0.7) {
    return -8
  }

  return 0
}

function shouldAffectRating(mode: GameMode) {
  return mode === 'adaptive'
}

function sideToColor(turn: 'w' | 'b'): PlayerColor {
  return turn === 'w' ? 'white' : 'black'
}

function evaluateTerminalState(chess: Chess, humanColor: PlayerColor) {
  if (chess.isCheckmate()) {
    const loser = sideToColor(chess.turn())
    const result: Exclude<GameResult, null> =
      loser === humanColor ? 'ai_win' : 'human_win'
    return {
      status: 'checkmate' as GameStatus,
      result,
    }
  }

  if (chess.isStalemate()) {
    return { status: 'stalemate' as GameStatus, result: 'draw' as const }
  }

  if (
    chess.isDraw() ||
    chess.isInsufficientMaterial() ||
    chess.isThreefoldRepetition()
  ) {
    return { status: 'draw' as GameStatus, result: 'draw' as const }
  }

  return null
}

function rebuildPgnFromMoves(moves: MoveEntry[]) {
  const chess = new Chess()

  for (const move of moves) {
    const applied = chess.move({
      from: move.from,
      to: move.to,
      promotion: 'q',
    })

    if (!applied) {
      throw new Error('Stored move history could not be replayed.')
    }
  }

  return chess.pgn()
}

function canUndoGame(game: GameRecord) {
  if (game.status !== 'active') {
    return false
  }

  return game.moveHistory.length >= (game.humanColor === 'black' ? 3 : 2)
}

function getTimeControlSettings(timeControl: TimeControlPreset) {
  switch (timeControl) {
    case '15_10':
      return { initialTimeMs: 15 * 60 * 1000, incrementMs: 10 * 1000 }
    case '10_0':
      return { initialTimeMs: 10 * 60 * 1000, incrementMs: 0 }
    case '5_0':
      return { initialTimeMs: 5 * 60 * 1000, incrementMs: 0 }
    case '15_0':
    default:
      return { initialTimeMs: 15 * 60 * 1000, incrementMs: 0 }
  }
}

function getActiveColor(game: GameRecord) {
  const chess = new Chess(game.fen)
  return sideToColor(chess.turn())
}

function applyClockTick(
  game: GameRecord,
  movingColor: PlayerColor,
  options?: {
    completedMove?: boolean
    nextTurnStartedAt?: string | null
  },
) {
  if (!game.activeTurnStartedAt) {
    return {
      ...game,
      activeTurnStartedAt: options?.nextTurnStartedAt ?? new Date().toISOString(),
    }
  }

  const now = options?.nextTurnStartedAt ?? new Date().toISOString()
  const elapsedMs = Math.max(
    0,
    new Date(now).getTime() - new Date(game.activeTurnStartedAt).getTime(),
  )
  const nextWhiteTime =
    movingColor === 'white'
      ? game.whiteTimeMs - elapsedMs + (options?.completedMove ? game.incrementMs : 0)
      : game.whiteTimeMs
  const nextBlackTime =
    movingColor === 'black'
      ? game.blackTimeMs - elapsedMs + (options?.completedMove ? game.incrementMs : 0)
      : game.blackTimeMs

  return {
    ...game,
    whiteTimeMs: nextWhiteTime,
    blackTimeMs: nextBlackTime,
    activeTurnStartedAt: options?.completedMove ? now : game.activeTurnStartedAt,
  }
}

function getFlaggedResult(game: GameRecord, flaggedColor: PlayerColor) {
  return flaggedColor === game.humanColor ? 'ai_win' : 'human_win'
}

async function requireAccount(request: Request, response: Response) {
  const auth = await getAuthenticatedAccount(request)
  if (!auth) {
    response.status(401).json({ error: 'Sign in required.' })
    return null
  }

  const state = await buildAccessState(auth.account)
  return { account: state.account, access: state.access }
}

async function loadAccountScopedUser(accountId: string, userId: string) {
  const user = await getUser(userId)
  if (!user || user.accountId !== accountId) {
    return null
  }

  return user
}

async function updateUserForResult(
  currentUser: UserRecord,
  result: Exclude<GameResult, null>,
  maxAdaptiveRating: number,
) {
  const now = new Date().toISOString()
  const ratingDelta = calculateRatingDelta(currentUser.targetAiRating, result)
  const nextRating = clamp(currentUser.targetAiRating + ratingDelta, 100, maxAdaptiveRating)

  return {
    user: {
      ...currentUser,
      targetAiRating: nextRating,
      gamesPlayed: currentUser.gamesPlayed + 1,
      wins: currentUser.wins + (result === 'human_win' ? 1 : 0),
      losses: currentUser.losses + (result === 'ai_win' ? 1 : 0),
      draws: currentUser.draws + (result === 'draw' ? 1 : 0),
      updatedAt: now,
    },
    ratingDelta,
  }
}

async function finalizeGame(
  game: GameRecord,
  result: Exclude<GameResult, null>,
  status: GameStatus,
) {
  const user = await getUser(game.userId)
  if (!user) {
    throw new Error('Profile not found.')
  }

  const account = await getAccountById(user.accountId)
  if (!account) {
    throw new Error('Account not found.')
  }

  const { access } = await buildAccessState(account)

  if (!shouldAffectRating(game.mode)) {
    const updatedGame = await updateGame(game.id, (currentGame) => ({
      ...currentGame,
      status,
      result,
      ratingDelta: null,
      updatedAt: new Date().toISOString(),
    }))

    return { user, game: updatedGame, account, access }
  }

  const { user: nextUser, ratingDelta } = await updateUserForResult(
    user,
    result,
    access.maxAdaptiveRating,
  )
  const updatedUser = await updateUser(user.id, () => nextUser)
  const updatedGame = await updateGame(game.id, (currentGame) => ({
    ...currentGame,
    status,
    result,
    ratingDelta,
    updatedAt: new Date().toISOString(),
  }))

  return { user: updatedUser, game: updatedGame, account, access }
}

async function buildGameResponse(game: GameRecord, user: UserRecord, account: AccountRecord) {
  const evaluation = await analyzePosition(game.fen)
  const { access } = await buildAccessState(account)
  return { game, user, evaluation, access }
}

app.post('/api/auth/sign-up', async (request, response) => {
  try {
    const email = typeof request.body?.email === 'string' ? request.body.email : ''
    const password =
      typeof request.body?.password === 'string' ? request.body.password : ''
    const account = await registerAccount(email, password)
    await createSessionForAccount(account.id, response)
    const users = await listUsersForAccount(account.id)
    const { access } = await buildAccessState(account)
    response.status(201).json({
      account: {
        id: account.id,
        email: account.email,
        isGuest: account.isGuest,
      },
      users,
      access,
    })
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not create account.',
    })
  }
})

app.post('/api/auth/sign-in', async (request, response) => {
  try {
    const email = typeof request.body?.email === 'string' ? request.body.email : ''
    const password =
      typeof request.body?.password === 'string' ? request.body.password : ''
    const account = await authenticateAccount(email, password)
    await createSessionForAccount(account.id, response)
    const users = await listUsersForAccount(account.id)
    const { access } = await buildAccessState(account)
    response.json({
      account: {
        id: account.id,
        email: account.email,
        isGuest: account.isGuest,
      },
      users,
      access,
    })
  } catch (error) {
    response.status(401).json({
      error: error instanceof Error ? error.message : 'Could not sign in.',
    })
  }
})

app.post('/api/auth/sign-out', async (request, response) => {
  await signOut(request, response)
  response.status(204).end()
})

app.post('/api/guest/session', async (request, response) => {
  try {
    const existing = await getAuthenticatedAccount(request)
    if (existing) {
      const users = await listUsersForAccount(existing.account.id)
      const { access } = await buildAccessState(existing.account)
      response.json({
        account: {
          id: existing.account.id,
          email: existing.account.email,
          isGuest: existing.account.isGuest,
        },
        users,
        access,
      })
      return
    }

    const account = await createGuestAccount()
    await createSessionForAccount(account.id, response)
    const users = await listUsersForAccount(account.id)
    const { access } = await buildAccessState(account)
    response.status(201).json({
      account: {
        id: account.id,
        email: account.email,
        isGuest: account.isGuest,
      },
      users,
      access,
    })
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not start guest session.',
    })
  }
})

app.get('/api/me', async (request, response) => {
  const state = await requireAccount(request, response)
  if (!state) {
    return
  }

  const users = await listUsersForAccount(state.account.id)
  response.json({
    account: {
      id: state.account.id,
      email: state.account.email,
      isGuest: state.account.isGuest,
    },
    users,
    access: state.access,
  })
})

app.get('/api/users', async (request, response) => {
  const state = await requireAccount(request, response)
  if (!state) {
    return
  }

  const users = await listUsersForAccount(state.account.id)
  response.json({ users, access: state.access })
})

app.get('/api/openings', async (_request, response) => {
  response.json({ openings: listOpenings() })
})

app.post('/api/users', async (request, response) => {
  try {
    const state = await requireAccount(request, response)
    if (!state) {
      return
    }

    const name =
      typeof request.body?.name === 'string' ? request.body.name : ''
    const user = await createUser(state.account.id, name)
    response.status(201).json({ user, access: state.access })
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not create profile.',
    })
  }
})

app.post('/api/billing/create-checkout-session', async (request, response) => {
  try {
    const state = await requireAccount(request, response)
    if (!state) {
      return
    }

    const url = await createCheckoutUrl(state.account)
    response.json({ url })
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not start checkout.',
    })
  }
})

app.post('/api/billing/customer-portal', async (request, response) => {
  try {
    const state = await requireAccount(request, response)
    if (!state) {
      return
    }

    const url = await createPortalUrl(state.account)
    response.json({ url })
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not open billing portal.',
    })
  }
})

app.post('/api/games', async (request, response) => {
  try {
    const state = await requireAccount(request, response)
    if (!state) {
      return
    }

    const userId =
      typeof request.body?.userId === 'string' ? request.body.userId : ''
    const humanColor = request.body?.humanColor === 'black' ? 'black' : 'white'
    const requestedMode: GameMode =
      request.body?.mode === 'act_as_ai' ? 'act_as_ai' : 'adaptive'
    const timeControl: TimeControlPreset =
      request.body?.timeControl === '15_10'
        ? '15_10'
        : request.body?.timeControl === '10_0'
          ? '10_0'
          : request.body?.timeControl === '5_0'
            ? '5_0'
            : '15_0'
    const openingId =
      typeof request.body?.openingId === 'string' ? request.body.openingId : null
    const user = await loadAccountScopedUser(state.account.id, userId)

    if (!user) {
      response.status(404).json({ error: 'Profile not found.' })
      return
    }

    const nextState = await consumeGameStart(state.account)
    const effectiveMode = requestedMode
    const aiColor: PlayerColor = humanColor === 'white' ? 'black' : 'white'
    const opening = getOpeningById(openingId)
    if (opening && opening.side !== aiColor) {
      response.status(400).json({
        error: `Selected opening is for ${opening.side}, but the AI is playing ${aiColor}.`,
      })
      return
    }

    const chess = new Chess()
    const now = new Date().toISOString()
    const clock = getTimeControlSettings(timeControl)
    const targetRating = clamp(user.targetAiRating, 100, nextState.access.maxAdaptiveRating)
    const game: GameRecord = {
      id: crypto.randomUUID(),
      userId: user.id,
      mode: effectiveMode,
      timeControl,
      initialTimeMs: clock.initialTimeMs,
      incrementMs: clock.incrementMs,
      whiteTimeMs: clock.initialTimeMs,
      blackTimeMs: clock.initialTimeMs,
      activeTurnStartedAt: now,
      openingId: opening?.id ?? null,
      openingName: opening?.name ?? null,
      openingSide: opening?.side ?? null,
      openingStatus: opening ? 'following' : 'none',
      humanColor,
      aiColor,
      status: 'active',
      result: null,
      fen: chess.fen(),
      pgn: '',
      moveHistory: [],
      positionHistory: [chess.fen()],
      adaptiveRating: targetRating,
      startingRating: targetRating,
      ratingDelta: null,
      engineLabel:
        effectiveMode === 'act_as_ai' ? 'Stockfish 18 Best Move' : 'Oscar Lite',
      createdAt: now,
      updatedAt: now,
    }

    let persisted = await createGame(game)

    if (humanColor === 'black') {
      const openingProgress = resolveOpeningProgress(game.openingId, game.moveHistory)
      const selectedMove =
        openingProgress.nextMove ??
        (
          await chooseEngineMove(chess.fen(), {
            mode: effectiveMode,
            targetAiRating: targetRating,
          })
        ).move
      const engineMove = chess.move(selectedMove)
      if (!engineMove) {
        throw new Error('Engine produced an illegal opening move.')
      }

      persisted = await updateGame(game.id, (currentGame) => ({
        ...applyClockTick(currentGame, 'white', {
          completedMove: true,
          nextTurnStartedAt: new Date().toISOString(),
        }),
        fen: chess.fen(),
        pgn: rebuildPgnFromMoves([
          ...currentGame.moveHistory,
          buildMoveEntry('ai', engineMove, currentGame.moveHistory.length + 1),
        ]),
        engineLabel: openingProgress.nextMove
          ? `${currentGame.openingName} Book`
          : currentGame.mode === 'act_as_ai'
            ? 'Stockfish 18 Best Move'
            : 'Oscar Lite',
        openingStatus: resolveOpeningProgress(
          currentGame.openingId,
          [
            ...currentGame.moveHistory,
            buildMoveEntry('ai', engineMove, currentGame.moveHistory.length + 1),
          ],
        ).openingStatus,
        moveHistory: [
          ...currentGame.moveHistory,
          buildMoveEntry('ai', engineMove, currentGame.moveHistory.length + 1),
        ],
        positionHistory: [...currentGame.positionHistory, chess.fen()],
        updatedAt: new Date().toISOString(),
      }))
    }

    const latestUser = (await getUser(user.id)) ?? user
    response.status(201).json(await buildGameResponse(persisted, latestUser, nextState.account))
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not start game.',
    })
  }
})

app.post('/api/games/:gameId/move', async (request, response) => {
  try {
    const state = await requireAccount(request, response)
    if (!state) {
      return
    }

    const game = await getGame(request.params.gameId)
    if (!game) {
      response.status(404).json({ error: 'Game not found.' })
      return
    }

    const gameUser = await getUser(game.userId)
    if (!gameUser || gameUser.accountId !== state.account.id) {
      response.status(404).json({ error: 'Game not found.' })
      return
    }

    if (game.status !== 'active') {
      response.status(400).json({ error: 'This game is already complete.' })
      return
    }

    const chess = new Chess(game.fen)
    const currentTurn = sideToColor(chess.turn())
    if (currentTurn !== game.humanColor) {
      response.status(400).json({ error: 'It is not the human turn.' })
      return
    }

    const timedBeforeMove = applyClockTick(game, currentTurn)
    if (
      (currentTurn === 'white' ? timedBeforeMove.whiteTimeMs : timedBeforeMove.blackTimeMs) <=
      0
    ) {
      const flaggedGame = await updateGame(game.id, () => ({
        ...timedBeforeMove,
        whiteTimeMs: Math.max(0, timedBeforeMove.whiteTimeMs),
        blackTimeMs: Math.max(0, timedBeforeMove.blackTimeMs),
      }))
      const finalized = await finalizeGame(
        flaggedGame,
        getFlaggedResult(flaggedGame, currentTurn),
        'timeout',
      )
      response.json(await buildGameResponse(finalized.game, finalized.user, finalized.account))
      return
    }

    const from =
      typeof request.body?.from === 'string' ? request.body.from : ''
    const to = typeof request.body?.to === 'string' ? request.body.to : ''
    const promotion =
      typeof request.body?.promotion === 'string' ? request.body.promotion : 'q'

    const humanMove = chess.move({ from, to, promotion })
    if (!humanMove) {
      response.status(400).json({ error: 'Illegal move.' })
      return
    }

    let updatedGame = await updateGame(game.id, (currentGame) => {
      const nextMoveHistory = [
        ...currentGame.moveHistory,
        buildMoveEntry('human', humanMove, currentGame.moveHistory.length + 1),
      ]
      const openingProgress = resolveOpeningProgress(
        currentGame.openingId,
        nextMoveHistory,
      )

      return {
        ...applyClockTick(currentGame, currentTurn, {
          completedMove: true,
          nextTurnStartedAt: new Date().toISOString(),
        }),
        fen: chess.fen(),
        pgn: rebuildPgnFromMoves(nextMoveHistory),
        moveHistory: nextMoveHistory,
        positionHistory: [...currentGame.positionHistory, chess.fen()],
        openingStatus: openingProgress.openingStatus,
        updatedAt: new Date().toISOString(),
      }
    })

    const terminalAfterHuman = evaluateTerminalState(chess, updatedGame.humanColor)
    if (terminalAfterHuman) {
      const finalized = await finalizeGame(
        updatedGame,
        terminalAfterHuman.result,
        terminalAfterHuman.status,
      )
      response.json(await buildGameResponse(finalized.game, finalized.user, finalized.account))
      return
    }

    const openingProgress = resolveOpeningProgress(
      updatedGame.openingId,
      updatedGame.moveHistory,
    )
    const engine =
      openingProgress.nextMove == null
        ? await chooseEngineMove(chess.fen(), {
            mode: updatedGame.mode,
            targetAiRating: updatedGame.adaptiveRating,
          })
        : null
    const aiMove = chess.move(openingProgress.nextMove ?? engine?.move ?? '')
    if (!aiMove) {
      throw new Error('Engine produced an illegal reply.')
    }

    updatedGame = await updateGame(game.id, (currentGame) => {
      const nextMoveHistory = [
        ...currentGame.moveHistory,
        buildMoveEntry('ai', aiMove, currentGame.moveHistory.length + 1),
      ]
      const nextOpeningProgress = resolveOpeningProgress(
        currentGame.openingId,
        nextMoveHistory,
      )

      return {
        ...applyClockTick(currentGame, updatedGame.aiColor, {
          completedMove: true,
          nextTurnStartedAt: new Date().toISOString(),
        }),
        fen: chess.fen(),
        pgn: rebuildPgnFromMoves(nextMoveHistory),
        engineLabel: openingProgress.nextMove
          ? `${currentGame.openingName} Book`
          : engine?.engineLabel ?? currentGame.engineLabel,
        moveHistory: nextMoveHistory,
        positionHistory: [...currentGame.positionHistory, chess.fen()],
        openingStatus: nextOpeningProgress.openingStatus,
        updatedAt: new Date().toISOString(),
      }
    })

    if (
      (updatedGame.aiColor === 'white' ? updatedGame.whiteTimeMs : updatedGame.blackTimeMs) <=
      0
    ) {
      const finalized = await finalizeGame(
        {
          ...updatedGame,
          whiteTimeMs: Math.max(0, updatedGame.whiteTimeMs),
          blackTimeMs: Math.max(0, updatedGame.blackTimeMs),
        },
        getFlaggedResult(updatedGame, updatedGame.aiColor),
        'timeout',
      )
      response.json(await buildGameResponse(finalized.game, finalized.user, finalized.account))
      return
    }

    const terminalAfterAi = evaluateTerminalState(chess, updatedGame.humanColor)
    if (terminalAfterAi) {
      const finalized = await finalizeGame(
        updatedGame,
        terminalAfterAi.result,
        terminalAfterAi.status,
      )
      response.json(await buildGameResponse(finalized.game, finalized.user, finalized.account))
      return
    }

    const user = await getUser(updatedGame.userId)
    if (!user) {
      throw new Error('Profile not found.')
    }

    response.json(await buildGameResponse(updatedGame, user, state.account))
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Move failed.',
    })
  }
})

app.post('/api/games/:gameId/undo', async (request, response) => {
  try {
    const state = await requireAccount(request, response)
    if (!state) {
      return
    }

    const game = await getGame(request.params.gameId)
    if (!game) {
      response.status(404).json({ error: 'Game not found.' })
      return
    }

    const gameUser = await getUser(game.userId)
    if (!gameUser || gameUser.accountId !== state.account.id) {
      response.status(404).json({ error: 'Game not found.' })
      return
    }

    if (!canUndoGame(game)) {
      response.status(400).json({ error: 'Undo is not available for this position.' })
      return
    }

    const nextMoveHistory = game.moveHistory.slice(0, -2)
    const nextPositionHistory = game.positionHistory.slice(0, -2)
    const restoredFen = nextPositionHistory.at(-1)

    if (!restoredFen) {
      response.status(400).json({ error: 'Could not restore the previous position.' })
      return
    }

    const updatedGame = await updateGame(game.id, (currentGame) => {
      const nextOpeningProgress = resolveOpeningProgress(
        currentGame.openingId,
        nextMoveHistory,
      )

      return {
        ...currentGame,
        fen: restoredFen,
        pgn: rebuildPgnFromMoves(nextMoveHistory),
        moveHistory: nextMoveHistory,
        positionHistory: nextPositionHistory,
        activeTurnStartedAt: new Date().toISOString(),
        openingStatus: nextOpeningProgress.openingStatus,
        engineLabel:
          nextOpeningProgress.openingStatus === 'following' &&
          nextOpeningProgress.openingName
            ? `${nextOpeningProgress.openingName} Book`
            : currentGame.mode === 'act_as_ai'
              ? 'Stockfish 18 Best Move'
              : 'Oscar Lite',
        updatedAt: new Date().toISOString(),
      }
    })

    response.json(await buildGameResponse(updatedGame, gameUser, state.account))
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not undo the last turn.',
    })
  }
})

app.post('/api/games/:gameId/flag', async (request, response) => {
  try {
    const state = await requireAccount(request, response)
    if (!state) {
      return
    }

    const game = await getGame(request.params.gameId)
    if (!game) {
      response.status(404).json({ error: 'Game not found.' })
      return
    }

    const gameUser = await getUser(game.userId)
    if (!gameUser || gameUser.accountId !== state.account.id) {
      response.status(404).json({ error: 'Game not found.' })
      return
    }

    if (game.status !== 'active') {
      response.status(400).json({ error: 'This game is already complete.' })
      return
    }

    const activeColor = getActiveColor(game)
    const timedGame = applyClockTick(game, activeColor)
    const remainingMs = activeColor === 'white' ? timedGame.whiteTimeMs : timedGame.blackTimeMs

    if (remainingMs > 0) {
      response.status(400).json({ error: 'Clock has not expired yet.' })
      return
    }

    const updatedTimedGame = await updateGame(game.id, () => ({
      ...timedGame,
      whiteTimeMs: Math.max(0, timedGame.whiteTimeMs),
      blackTimeMs: Math.max(0, timedGame.blackTimeMs),
    }))
    const finalized = await finalizeGame(
      updatedTimedGame,
      getFlaggedResult(updatedTimedGame, activeColor),
      'timeout',
    )
    response.json(await buildGameResponse(finalized.game, finalized.user, finalized.account))
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not flag the clock.',
    })
  }
})

app.post('/api/games/:gameId/resign', async (request, response) => {
  try {
    const state = await requireAccount(request, response)
    if (!state) {
      return
    }

    const game = await getGame(request.params.gameId)
    if (!game) {
      response.status(404).json({ error: 'Game not found.' })
      return
    }

    const gameUser = await getUser(game.userId)
    if (!gameUser || gameUser.accountId !== state.account.id) {
      response.status(404).json({ error: 'Game not found.' })
      return
    }

    if (game.status !== 'active') {
      response.status(400).json({ error: 'This game is already complete.' })
      return
    }

    const finalized = await finalizeGame(game, 'ai_win', 'resigned')
    response.json(await buildGameResponse(finalized.game, finalized.user, finalized.account))
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not resign.',
    })
  }
})

if (existsSync(distDir)) {
  app.use(express.static(distDir))

  app.get(/^(?!\/api\/).*/, (_request, response) => {
    response.sendFile(indexFile)
  })
}

app.listen(port, host, () => {
  console.log(`Oscar server listening on http://${host}:${port}`)
  console.log(`Serving frontend from ${distDir}`)
  console.log(`Using data directory ${dataDirectory}`)
  console.log(`Supabase configured: ${isSupabaseConfigured()}`)
  if (process.env.STRIPE_SECRET_KEY) {
    console.log('Stripe billing enabled')
  }
})
