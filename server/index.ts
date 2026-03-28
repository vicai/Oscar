import express from 'express'
import { Chess } from 'chess.js'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyzePosition, chooseEngineMove } from './engine.js'
import {
  getOpeningById,
  listOpenings,
  resolveOpeningProgress,
} from './openings.js'
import {
  createGame,
  createUser,
  getGame,
  getUser,
  listUsers,
  updateGame,
  updateUser,
} from './store.js'
import type {
  GameMode,
  GameRecord,
  GameResult,
  GameStatus,
  MoveEntry,
  PlayerColor,
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

app.use(express.json())

app.get('/healthz', (_request, response) => {
  response.status(200).json({
    ok: true,
    port,
    dataDir: dataDirectory,
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

function updateUserForResult(
  currentUser: Awaited<ReturnType<typeof getUser>> extends infer R
    ? NonNullable<R>
    : never,
  result: Exclude<GameResult, null>,
) {
  const now = new Date().toISOString()
  const ratingDelta = calculateRatingDelta(currentUser.targetAiRating, result)
  const nextRating = clamp(currentUser.targetAiRating + ratingDelta, 100, 3200)

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

async function finalizeGame(
  game: GameRecord,
  result: Exclude<GameResult, null>,
  status: GameStatus,
) {
  const user = await getUser(game.userId)
  if (!user) {
    throw new Error('Profile not found.')
  }

  if (!shouldAffectRating(game.mode)) {
    const updatedGame = await updateGame(game.id, (currentGame) => ({
      ...currentGame,
      status,
      result,
      ratingDelta: null,
      updatedAt: new Date().toISOString(),
    }))

    return { user, game: updatedGame }
  }

  const { user: nextUser, ratingDelta } = updateUserForResult(user, result)
  const updatedUser = await updateUser(user.id, () => nextUser)
  const updatedGame = await updateGame(game.id, (currentGame) => ({
    ...currentGame,
    status,
    result,
    ratingDelta,
    updatedAt: new Date().toISOString(),
  }))

  return { user: updatedUser, game: updatedGame }
}

async function buildGameResponse(game: GameRecord, user: UserRecord) {
  const evaluation = await analyzePosition(game.fen)
  return { game, user, evaluation }
}

function canUndoGame(game: GameRecord) {
  if (game.status !== 'active') {
    return false
  }

  const rollbackPlyCount = game.humanColor === 'black' ? 2 : 2
  return game.moveHistory.length >= rollbackPlyCount + (game.humanColor === 'black' ? 1 : 0)
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

app.get('/api/users', async (_request, response) => {
  const users = await listUsers()
  response.json({ users })
})

app.get('/api/openings', async (_request, response) => {
  response.json({ openings: listOpenings() })
})

app.post('/api/users', async (request, response) => {
  try {
    const name =
      typeof request.body?.name === 'string' ? request.body.name : ''
    const user = await createUser(name)
    response.status(201).json({ user })
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not create profile.',
    })
  }
})

app.post('/api/games', async (request, response) => {
  try {
    const userId =
      typeof request.body?.userId === 'string' ? request.body.userId : ''
    const humanColor = request.body?.humanColor === 'black' ? 'black' : 'white'
    const mode: GameMode =
      request.body?.mode === 'act_as_ai' ? 'act_as_ai' : 'adaptive'
    const openingId =
      typeof request.body?.openingId === 'string' ? request.body.openingId : null
    const user = await getUser(userId)
    if (!user) {
      response.status(404).json({ error: 'Profile not found.' })
      return
    }

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
    const game: GameRecord = {
      id: crypto.randomUUID(),
      userId: user.id,
      mode,
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
      adaptiveRating: user.targetAiRating,
      startingRating: user.targetAiRating,
      ratingDelta: null,
      engineLabel: 'Stockfish 18 Lite',
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
            mode,
            targetAiRating: user.targetAiRating,
          })
        ).move
      const engineMove = chess.move(selectedMove)
      if (!engineMove) {
        throw new Error('Engine produced an illegal opening move.')
      }

      persisted = await updateGame(game.id, (currentGame) => ({
        ...currentGame,
        fen: chess.fen(),
        pgn: rebuildPgnFromMoves([
          ...currentGame.moveHistory,
          buildMoveEntry('ai', engineMove, currentGame.moveHistory.length + 1),
        ]),
        engineLabel: openingProgress.nextMove
          ? `${currentGame.openingName} Book`
          : currentGame.mode === 'act_as_ai'
            ? 'Stockfish 18 Best Move'
            : 'Stockfish 18 Lite',
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

    response.status(201).json(await buildGameResponse(persisted, user))
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not start game.',
    })
  }
})

app.post('/api/games/:gameId/move', async (request, response) => {
  try {
    const game = await getGame(request.params.gameId)
    if (!game) {
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
        ...currentGame,
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
      response.json(await buildGameResponse(finalized.game, finalized.user))
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
        ...currentGame,
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

    const terminalAfterAi = evaluateTerminalState(chess, updatedGame.humanColor)
    if (terminalAfterAi) {
      const finalized = await finalizeGame(
        updatedGame,
        terminalAfterAi.result,
        terminalAfterAi.status,
      )
      response.json(await buildGameResponse(finalized.game, finalized.user))
      return
    }

    const user = await getUser(updatedGame.userId)
    if (!user) {
      throw new Error('Profile not found.')
    }

    response.json(await buildGameResponse(updatedGame, user))
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Move failed.',
    })
  }
})

app.post('/api/games/:gameId/undo', async (request, response) => {
  try {
    const game = await getGame(request.params.gameId)
    if (!game) {
      response.status(404).json({ error: 'Game not found.' })
      return
    }

    if (!canUndoGame(game)) {
      response.status(400).json({ error: 'Undo is not available for this position.' })
      return
    }

    const undoCount = 2
    const nextMoveHistory = game.moveHistory.slice(0, -undoCount)
    const nextPositionHistory = game.positionHistory.slice(0, -undoCount)
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
        openingStatus: nextOpeningProgress.openingStatus,
        engineLabel:
          nextOpeningProgress.openingStatus === 'following' &&
          nextOpeningProgress.openingName
            ? `${nextOpeningProgress.openingName} Book`
            : currentGame.mode === 'act_as_ai'
              ? 'Stockfish 18 Best Move'
              : 'Stockfish 18 Lite',
        updatedAt: new Date().toISOString(),
      }
    })

    const user = await getUser(updatedGame.userId)
    if (!user) {
      throw new Error('Profile not found.')
    }

    response.json(await buildGameResponse(updatedGame, user))
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Could not undo the last turn.',
    })
  }
})

app.post('/api/games/:gameId/resign', async (request, response) => {
  try {
    const game = await getGame(request.params.gameId)
    if (!game) {
      response.status(404).json({ error: 'Game not found.' })
      return
    }

    if (game.status !== 'active') {
      response.status(400).json({ error: 'This game is already complete.' })
      return
    }

    const finalized = await finalizeGame(game, 'ai_win', 'resigned')
    response.json(await buildGameResponse(finalized.game, finalized.user))
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
})
