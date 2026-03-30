import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Chess } from 'chess.js'
import type { Move, Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import './App.css'

type Account = {
  id: string
  email: string
  isGuest: boolean
}

type AccessState = {
  plan: 'free' | 'premium'
  subscriptionStatus: 'inactive' | 'active' | 'trialing' | 'past_due' | 'canceled'
  canUseBestMove: boolean
  maxAdaptiveRating: number
  freeDailyGameCap: number
  remainingFreeGamesToday: number | null
  upgradeCtaLabel: string | null
}

type User = {
  id: string
  name: string
  targetAiRating: number
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
}

type Opening = {
  id: string
  name: string
  side: 'white' | 'black'
  style: string
}

type MoveEntry = {
  ply: number
  actor: 'human' | 'ai'
  san: string
  from: string
  to: string
}

type Evaluation = {
  scoreCp: number | null
  mateIn: number | null
  advantage: number
  label: string
}

type GameStatus =
  | 'active'
  | 'checkmate'
  | 'stalemate'
  | 'draw'
  | 'resigned'

type GameMode = 'adaptive' | 'act_as_ai'
type TimeControlPreset = '15_0' | '15_10' | '10_0' | '5_0'

type GameView = {
  id: string
  userId: string
  mode: GameMode
  timeControl: TimeControlPreset
  initialTimeMs: number
  incrementMs: number
  whiteTimeMs: number
  blackTimeMs: number
  activeTurnStartedAt: string | null
  openingId: string | null
  openingName: string | null
  openingSide: 'white' | 'black' | null
  openingStatus: 'none' | 'following' | 'broken'
  humanColor: 'white' | 'black'
  aiColor: 'white' | 'black'
  status: GameStatus
  result: 'human_win' | 'ai_win' | 'draw' | null
  fen: string
  pgn: string
  moveHistory: MoveEntry[]
  positionHistory: string[]
  adaptiveRating: number
  startingRating: number
  ratingDelta: number | null
  engineLabel: string
}

type GameResponse = {
  game: GameView
  user: User
  evaluation: Evaluation
  access: AccessState
}

type MeResponse = {
  account: Account
  users: User[]
  access: AccessState
}

type AuthResponse = MeResponse

async function readJson<T>(response: Response) {
  return (await response.json()) as T
}

async function apiRequest<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init)
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as
      | { error?: string }
      | null
    throw new Error(error?.error ?? 'Request failed.')
  }

  if (response.status === 204) {
    return null as T
  }

  return readJson<T>(response)
}

const api = {
  me() {
    return apiRequest<MeResponse>('/api/me')
  },
  ensureGuestSession() {
    return apiRequest<MeResponse>('/api/guest/session', {
      method: 'POST',
    })
  },
  signUp(email: string, password: string) {
    return apiRequest<AuthResponse>('/api/auth/sign-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  },
  signIn(email: string, password: string) {
    return apiRequest<AuthResponse>('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  },
  signOut() {
    return apiRequest<null>('/api/auth/sign-out', {
      method: 'POST',
    })
  },
  async getOpenings() {
    return apiRequest<{ openings: Opening[] }>('/api/openings')
  },
  createUser(name: string) {
    return apiRequest<{ user: User; access: AccessState }>('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  },
  startGame(
    userId: string,
    humanColor: 'white' | 'black',
    mode: GameMode,
    timeControl: TimeControlPreset,
    openingId: string | null,
  ) {
    return apiRequest<GameResponse>('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, humanColor, mode, timeControl, openingId }),
    })
  },
  makeMove(gameId: string, from: string, to: string) {
    return apiRequest<GameResponse>(`/api/games/${gameId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, promotion: 'q' }),
    })
  },
  resign(gameId: string) {
    return apiRequest<GameResponse>(`/api/games/${gameId}/resign`, {
      method: 'POST',
    })
  },
  undo(gameId: string) {
    return apiRequest<GameResponse>(`/api/games/${gameId}/undo`, {
      method: 'POST',
    })
  },
  flag(gameId: string) {
    return apiRequest<GameResponse>(`/api/games/${gameId}/flag`, {
      method: 'POST',
    })
  },
  createCheckoutSession() {
    return apiRequest<{ url: string }>('/api/billing/create-checkout-session', {
      method: 'POST',
    })
  },
  createCustomerPortal() {
    return apiRequest<{ url: string }>('/api/billing/customer-portal', {
      method: 'POST',
    })
  },
}

function formatResult(game: GameView | null) {
  if (!game) {
    return 'No game loaded.'
  }

  if (game.status === 'active') {
    return 'Game in progress'
  }

  if (game.result === 'human_win') {
    return 'You won'
  }

  if (game.result === 'ai_win') {
    return 'Oscar won'
  }

  return 'Draw'
}

function formatTurn(game: GameView | null) {
  if (!game) {
    return 'Choose a profile and start a game.'
  }

  if (game.status !== 'active') {
    return formatResult(game)
  }

  const chess = new Chess(game.fen)
  const current = chess.turn() === 'w' ? 'white' : 'black'
  return current === game.humanColor
    ? 'Your move'
    : game.mode === 'act_as_ai'
      ? 'Stockfish is choosing the best move'
      : 'Oscar Lite is thinking'
}

function formatOpeningStatus(game: GameView | null) {
  if (!game || !game.openingId || !game.openingName) {
    return 'No opening selected'
  }

  if (game.openingStatus === 'following') {
    return `Following ${game.openingName}`
  }

  return `${game.openingName} broken, engine continued normally`
}

function isHumanOwnedSquare(
  chess: Chess | null,
  square: string,
  humanColor: 'white' | 'black',
) {
  const piece = chess?.get(square as Square)
  if (!piece) {
    return false
  }

  return piece.color === (humanColor === 'white' ? 'w' : 'b')
}

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function App() {
  const [account, setAccount] = useState<Account | null>(null)
  const [access, setAccess] = useState<AccessState | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [openings, setOpenings] = useState<Opening[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMode, setAuthMode] = useState<'sign_in' | 'sign_up'>('sign_up')
  const [game, setGame] = useState<GameView | null>(null)
  const [humanColor, setHumanColor] = useState<'white' | 'black'>('white')
  const [gameMode, setGameMode] = useState<GameMode>('act_as_ai')
  const [timeControl, setTimeControl] = useState<TimeControlPreset>('15_10')
  const [selectedOpeningId, setSelectedOpeningId] = useState('')
  const [isBoardFlipped, setIsBoardFlipped] = useState(false)
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [loadingApp, setLoadingApp] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [clockNow, setClockNow] = useState(Date.now())
  const [flaggingGameId, setFlaggingGameId] = useState<string | null>(null)

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  )
  const aiSide = humanColor === 'white' ? 'black' : 'white'
  const activeHumanColor = game?.humanColor ?? humanColor
  const availableOpenings = useMemo(
    () => openings.filter((opening) => opening.side === aiSide),
    [aiSide, openings],
  )

  useEffect(() => {
    if (
      selectedOpeningId &&
      !availableOpenings.some((opening) => opening.id === selectedOpeningId)
    ) {
      setSelectedOpeningId('')
    }
  }, [availableOpenings, selectedOpeningId])

  useEffect(() => {
    void (async () => {
      try {
        const openingData = await api.getOpenings()
        setOpenings(openingData.openings)

        try {
          const me = await api.me()
          setAccount(me.account)
          setUsers(me.users)
          setAccess(me.access)
          if (me.users[0]) {
            setSelectedUserId(me.users[0].id)
          }
        } catch {
          const guest = await api.ensureGuestSession()
          setAccount(guest.account)
          setUsers(guest.users)
          setAccess(guest.access)
          if (guest.users[0]) {
            setSelectedUserId(guest.users[0].id)
          }
        }
      } catch (caughtError) {
        setError(
          caughtError instanceof Error ? caughtError.message : 'Failed to load app.',
        )
      } finally {
        setLoadingApp(false)
      }
    })()
  }, [])

  const boardFen = optimisticFen ?? game?.fen ?? undefined
  const boardChess = useMemo(() => {
    if (!boardFen) {
      return null
    }

    return new Chess(boardFen)
  }, [boardFen])
  const baseOrientation = game?.humanColor ?? humanColor
  const boardOrientation =
    isBoardFlipped
      ? baseOrientation === 'white'
        ? 'black'
        : 'white'
      : baseOrientation
  const evaluationAdvantage = evaluation?.advantage ?? 0.5
  const topSide = boardOrientation === 'white' ? 'Black' : 'White'
  const bottomSide = boardOrientation === 'white' ? 'White' : 'Black'
  const topFill = boardOrientation === 'white'
    ? 1 - evaluationAdvantage
    : evaluationAdvantage
  const bottomFill = 1 - topFill
  const canInteract =
    Boolean(game) &&
    game?.status === 'active' &&
    !submitting &&
    new Chess(game.fen).turn() === (game.humanColor === 'white' ? 'w' : 'b')
  const canUndo = game
    ? game.status === 'active' &&
      !submitting &&
      game.moveHistory.length >= (game.humanColor === 'black' ? 3 : 2)
    : false
  const activeClockColor = game ? (new Chess(game.fen).turn() === 'w' ? 'white' : 'black') : null
  const legalTargets =
    canInteract && selectedSquare && boardChess
      ? (boardChess.moves({
          square: selectedSquare as Square,
          verbose: true,
        }) as Move[]).map((move) => move.to)
      : []

  useEffect(() => {
    setSelectedSquare(null)
  }, [game?.id, game?.fen, optimisticFen, submitting])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockNow(Date.now())
    }, 250)

    return () => window.clearInterval(interval)
  }, [])

  const liveWhiteTimeMs = game
    ? Math.max(
        0,
        game.whiteTimeMs -
          (game.status === 'active' &&
          activeClockColor === 'white' &&
          game.activeTurnStartedAt
            ? clockNow - new Date(game.activeTurnStartedAt).getTime()
            : 0),
      )
    : 0
  const liveBlackTimeMs = game
    ? Math.max(
        0,
        game.blackTimeMs -
          (game.status === 'active' &&
          activeClockColor === 'black' &&
          game.activeTurnStartedAt
            ? clockNow - new Date(game.activeTurnStartedAt).getTime()
            : 0),
      )
    : 0

  useEffect(() => {
    if (
      !game ||
      game.status !== 'active' ||
      !canInteract ||
      flaggingGameId === game.id
    ) {
      return
    }

    const humanClockMs =
      game.humanColor === 'white' ? liveWhiteTimeMs : liveBlackTimeMs
    if (humanClockMs > 0) {
      return
    }

    setFlaggingGameId(game.id)
    void (async () => {
      try {
        const data = await api.flag(game.id)
        setGame(data.game)
        setEvaluation(data.evaluation)
        setAccess(data.access)
        setMessage('Time expired.')
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Failed to flag the clock.',
        )
      } finally {
        setFlaggingGameId(null)
      }
    })()
  }, [canInteract, flaggingGameId, game, liveBlackTimeMs, liveWhiteTimeMs])

  function applyAuthState(data: AuthResponse | MeResponse) {
    setAccount(data.account)
    setUsers(data.users)
    setAccess(data.access)
    setSelectedUserId((current) =>
      data.users.some((user) => user.id === current)
        ? current
        : (data.users[0]?.id ?? ''),
    )
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const data =
        authMode === 'sign_up'
          ? await api.signUp(authEmail, authPassword)
          : await api.signIn(authEmail, authPassword)
      applyAuthState(data)
      setGame(null)
      setEvaluation(null)
      setMessage(
        authMode === 'sign_up'
          ? 'Account created. You can now create profiles and play.'
          : `Signed in as ${data.account.email}.`,
      )
      setAuthPassword('')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Authentication failed.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSignOut() {
    setSubmitting(true)
    setError('')
    try {
      await api.signOut()
      const guest = await api.ensureGuestSession()
      applyAuthState(guest)
      setGame(null)
      setEvaluation(null)
      setMessage('Signed out. Guest play is still available.')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Could not sign out.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function refreshAccount() {
    const me = await api.me()
    applyAuthState(me)
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = newUserName.trim()
    if (!trimmedName) {
      setError('Enter a profile name first.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const data = await api.createUser(trimmedName)
      await refreshAccount()
      setNewUserName('')
      setGame(null)
      setEvaluation(null)
      setAccess(data.access)
      setMessage(`Created profile for ${trimmedName}.`)
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Failed to create profile.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStartGame() {
    if (!selectedUserId) {
      setError('Select a profile before starting a game.')
      return
    }

    setSubmitting(true)
    setOptimisticFen(null)
    setError('')

    try {
      const data = await api.startGame(
        selectedUserId,
        humanColor,
        gameMode,
        timeControl,
        selectedOpeningId || null,
      )
      setGame(data.game)
      setEvaluation(data.evaluation)
      setAccess(data.access)
      await refreshAccount()
      setMessage(
        data.game.mode === 'act_as_ai'
          ? 'Premium Best Move game started.'
          : data.access.plan === 'free'
            ? `Oscar Lite started. ${data.access.remainingFreeGamesToday ?? 0} free games left today.`
            : `${data.user.name} started an adaptive premium game.`,
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Failed to start a game.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResign() {
    if (!game || game.status !== 'active') {
      return
    }

    setSubmitting(true)
    setError('')
    setOptimisticFen(null)

    try {
      const data = await api.resign(game.id)
      setGame(data.game)
      setEvaluation(data.evaluation)
      setAccess(data.access)
      await refreshAccount()
      setMessage(
        data.game.mode === 'act_as_ai'
          ? 'Best Move game finished. Premium rating is unchanged.'
          : `${formatResult(data.game)}. Adaptive rating is now ${data.user.targetAiRating}.`,
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Failed to resign.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function submitMove(from: string, to: string) {
    if (!game || game.status !== 'active') {
      return
    }

    const localChess = new Chess(game.fen)
    const movedPiece = localChess.move({ from, to, promotion: 'q' })
    if (!movedPiece) {
      return
    }

    setSubmitting(true)
    setError('')
    setOptimisticFen(localChess.fen())

    try {
      const data = await api.makeMove(game.id, from, to)
      setGame(data.game)
      setEvaluation(data.evaluation)
      setAccess(data.access)
      await refreshAccount()
      setMessage(
        data.game.status === 'active'
          ? data.game.mode === 'act_as_ai'
            ? 'Stockfish returned its strongest reply.'
            : `Oscar Lite remains capped at ${data.access.maxAdaptiveRating}.`
          : data.game.mode === 'act_as_ai'
            ? `${formatResult(data.game)}. Premium Best Move complete.`
            : `${formatResult(data.game)}. Adaptive rating: ${data.user.targetAiRating}.`,
      )
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Move rejected.',
      )
    } finally {
      setOptimisticFen(null)
      setSubmitting(false)
    }
  }

  async function handleUndo() {
    if (!game || !canUndo) {
      return
    }

    setSubmitting(true)
    setError('')
    setOptimisticFen(null)

    try {
      const data = await api.undo(game.id)
      setGame(data.game)
      setEvaluation(data.evaluation)
      setAccess(data.access)
      setMessage('Last turn undone.')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Failed to undo the last turn.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpgrade() {
    if (account?.isGuest) {
      setError('Create an account or sign in before upgrading to premium.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const data = await api.createCheckoutSession()
      window.location.href = data.url
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Could not open checkout.',
      )
      setSubmitting(false)
    }
  }

  async function handleManageBilling() {
    if (account?.isGuest) {
      setError('Guest sessions do not have billing access.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const data = await api.createCustomerPortal()
      window.location.href = data.url
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Could not open billing.',
      )
      setSubmitting(false)
    }
  }

  function handleSquarePress(square: string) {
    if (!game || !boardChess || !canInteract) {
      setSelectedSquare(null)
      return
    }

    if (!selectedSquare) {
      if (isHumanOwnedSquare(boardChess, square, game.humanColor)) {
        setSelectedSquare(square)
      }
      return
    }

    if (square === selectedSquare) {
      setSelectedSquare(null)
      return
    }

    if (legalTargets.includes(square as Square)) {
      setSelectedSquare(null)
      void submitMove(selectedSquare, square)
      return
    }

    if (isHumanOwnedSquare(boardChess, square, game.humanColor)) {
      setSelectedSquare(square)
      return
    }

    setSelectedSquare(null)
  }

  const lastMove = game?.moveHistory.at(-1)
  const squareStyles = {
    ...(lastMove
      ? {
          [lastMove.from]: {
            background:
              'linear-gradient(180deg, rgba(255, 217, 102, 0.48), rgba(255, 181, 71, 0.2))',
          },
          [lastMove.to]: {
            background:
              'linear-gradient(180deg, rgba(255, 217, 102, 0.72), rgba(255, 181, 71, 0.38))',
          },
        }
      : {}),
    ...(selectedSquare
      ? {
          [selectedSquare]: {
            background:
              'linear-gradient(180deg, rgba(130, 220, 116, 0.42), rgba(74, 195, 113, 0.22))',
            boxShadow: 'inset 0 0 0 3px rgba(60, 168, 84, 0.9)',
          },
        }
      : {}),
    ...Object.fromEntries(
      legalTargets.map((square) => {
        const occupied = Boolean(boardChess?.get(square as Square))
        return [
          square,
          occupied
            ? {
                background:
                  'radial-gradient(circle, rgba(107, 213, 120, 0.06) 0%, rgba(107, 213, 120, 0.06) 58%, rgba(61, 179, 86, 0.92) 59%, rgba(61, 179, 86, 0.92) 72%, rgba(61, 179, 86, 0.18) 73%, rgba(61, 179, 86, 0.18) 100%)',
              }
            : {
                background:
                  'radial-gradient(circle, rgba(61, 179, 86, 0.92) 0%, rgba(61, 179, 86, 0.92) 16%, rgba(61, 179, 86, 0.24) 17%, rgba(61, 179, 86, 0.24) 100%)',
              },
        ]
      }),
    ),
  }
  const boardHint = !game
    ? 'Start a game to load the board.'
    : !canInteract
      ? 'Wait for Oscar to reply.'
      : selectedSquare
        ? legalTargets.length
          ? `Tap a highlighted square to move ${selectedSquare}.`
          : `No legal moves from ${selectedSquare}.`
        : 'Tap a piece to reveal its legal moves.'
  const topClockMs = boardOrientation === 'white' ? liveBlackTimeMs : liveWhiteTimeMs
  const bottomClockMs = boardOrientation === 'white' ? liveWhiteTimeMs : liveBlackTimeMs
  const topClockLabel = boardOrientation === 'white' ? 'Black' : 'White'
  const bottomClockLabel = boardOrientation === 'white' ? 'White' : 'Black'
  const topClockActive = activeClockColor === (boardOrientation === 'white' ? 'black' : 'white')
  const bottomClockActive = activeClockColor === (boardOrientation === 'white' ? 'white' : 'black')

  if (loadingApp) {
    return (
      <main className="shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Oscar Chess Workspace</p>
            <h1>Loading Oscar...</h1>
          </div>
        </section>
      </main>
    )
  }

  if (!account || !access) {
    return (
      <main className="shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Oscar Chess Workspace</p>
            <h1>Chess AI with a free Lite tier and premium Stockfish Best Move.</h1>
            <p className="hero-text">
              Create an account to sync progress and unlock premium. Free Oscar
              Lite can also be played as a guest.
            </p>
          </div>

          <div className="panel auth-panel">
            <div className="auth-toggle">
              <button
                className={authMode === 'sign_up' ? 'primary' : 'secondary'}
                type="button"
                onClick={() => setAuthMode('sign_up')}
              >
                Sign up
              </button>
              <button
                className={authMode === 'sign_in' ? 'primary' : 'secondary'}
                type="button"
                onClick={() => setAuthMode('sign_in')}
              >
                Sign in
              </button>
            </div>

            <form className="stack" onSubmit={handleAuth}>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
              </label>
              <button className="primary" disabled={submitting}>
                {authMode === 'sign_up' ? 'Create account' : 'Sign in'}
              </button>
            </form>

            <div className="tier-list">
              <div className="tier-card">
                <span>Free</span>
                <strong>Oscar Lite</strong>
                <small>Playable as guest. Adaptive play capped at about 2000 with daily game limits.</small>
              </div>
              <div className="tier-card premium-tier">
                <span>Premium</span>
                <strong>$1.99/month</strong>
                <small>Unlock Best Move Stockfish and unlimited games.</small>
              </div>
            </div>

            {error ? <p className="banner error">{error}</p> : null}
            {message ? <p className="banner info">{message}</p> : null}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Oscar Chess Workspace</p>
          <h1>Free Oscar Lite on one side. Premium Stockfish Best Move on the other.</h1>
          <p className="hero-text">
            Signed in as {account.email}. Free stays capped and metered. Premium
            unlocks strongest play and unlimited sessions.
          </p>
        </div>

        <div className="hero-stats">
          <div className="stat-card">
            <span>Plan</span>
            <strong>{access.plan === 'premium' ? 'Premium' : 'Free'}</strong>
          </div>
          <div className="stat-card">
            <span>Free Games Left</span>
            <strong>
              {access.remainingFreeGamesToday == null
                ? 'Unlimited'
                : access.remainingFreeGamesToday}
            </strong>
          </div>
          <div className="stat-card">
            <span>Adaptive Cap</span>
            <strong>{access.maxAdaptiveRating}</strong>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel">
            <div className="panel-heading">
              <h2>Account</h2>
              <p>{account.isGuest ? 'Guest session' : account.email}</p>
            </div>

            <div className="account-meta">
              <span className={`plan-pill ${access.plan}`}>
                {access.plan === 'premium' ? 'Premium' : 'Free'}
              </span>
              <span className="muted">
                {access.remainingFreeGamesToday == null
                  ? 'Unlimited games'
                  : `${access.remainingFreeGamesToday}/${access.freeDailyGameCap} free games left today`}
              </span>
            </div>

            {account.isGuest ? (
              <div className="stack">
                <p className="setup-hint">
                  Guest play is enabled. Sign in or create an account to keep a
                  real identity and upgrade to premium.
                </p>
                <div className="auth-toggle">
                  <button
                    className={authMode === 'sign_up' ? 'primary' : 'secondary'}
                    type="button"
                    onClick={() => setAuthMode('sign_up')}
                  >
                    Sign up
                  </button>
                  <button
                    className={authMode === 'sign_in' ? 'primary' : 'secondary'}
                    type="button"
                    onClick={() => setAuthMode('sign_in')}
                  >
                    Sign in
                  </button>
                </div>
                <form className="stack" onSubmit={handleAuth}>
                  <label className="field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label className="field">
                    <span>Password</span>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      placeholder="At least 8 characters"
                    />
                  </label>
                  <button className="primary" disabled={submitting}>
                    {authMode === 'sign_up' ? 'Create account' : 'Sign in'}
                  </button>
                </form>
              </div>
            ) : (
              <div className="action-row stacked-actions">
                {access.plan === 'premium' ? (
                  <button
                    className="primary"
                    type="button"
                    disabled={submitting}
                    onClick={handleManageBilling}
                  >
                    Manage billing
                  </button>
                ) : (
                  <button
                    className="primary"
                    type="button"
                    disabled={submitting}
                    onClick={handleUpgrade}
                  >
                    {access.upgradeCtaLabel ?? 'Upgrade'}
                  </button>
                )}
                <button
                  className="secondary"
                  type="button"
                  disabled={submitting}
                  onClick={handleSignOut}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Profiles</h2>
              <p>Profiles now live inside your account.</p>
            </div>

            <form className="stack" onSubmit={handleCreateUser}>
              <label className="field">
                <span>New profile</span>
                <input
                  value={newUserName}
                  onChange={(event) => setNewUserName(event.target.value)}
                  placeholder="Magnus, Maya, Coach..."
                  maxLength={32}
                />
              </label>
              <button className="primary" disabled={submitting}>
                Create profile
              </button>
            </form>

            <div className="profile-list">
              {users.length === 0 ? (
                <p className="muted">No profiles yet.</p>
              ) : (
                users.map((user) => (
                  <button
                    key={user.id}
                    className={
                      user.id === selectedUserId ? 'profile active' : 'profile'
                    }
                    onClick={() => {
                      setSelectedUserId(user.id)
                      setGame(null)
                      setEvaluation(null)
                      setMessage(`${user.name} selected.`)
                    }}
                    type="button"
                  >
                    <span>{user.name}</span>
                    <strong>{user.targetAiRating}</strong>
                    <small>
                      {user.wins}-{user.losses}-{user.draws}
                    </small>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Match Setup</h2>
              <p>
                Free uses Oscar Lite. Premium unlocks strongest Best Move and
                unlimited access.
              </p>
            </div>

            <div className="setup-fields">
              <label className="field">
                <span>Mode</span>
                <select
                  value={gameMode}
                  onChange={(event) => setGameMode(event.target.value as GameMode)}
                  disabled={submitting}
                >
                  <option value="act_as_ai">Best Move</option>
                  <option value="adaptive">Adaptive Play</option>
                </select>
              </label>

              <label className="field">
                <span>Play as</span>
                <select
                  value={humanColor}
                  onChange={(event) =>
                    setHumanColor(event.target.value as 'white' | 'black')
                  }
                  disabled={submitting}
                >
                  <option value="white">White</option>
                  <option value="black">Black</option>
                </select>
              </label>

              <label className="field">
                <span>Clock</span>
                <select
                  value={timeControl}
                  onChange={(event) =>
                    setTimeControl(event.target.value as TimeControlPreset)
                  }
                  disabled={submitting}
                >
                  <option value="15_10">15 | 10</option>
                  <option value="15_0">15 | 0</option>
                  <option value="10_0">10 | 0</option>
                  <option value="5_0">5 | 0</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>Opening for AI</span>
              <select
                value={selectedOpeningId}
                onChange={(event) => setSelectedOpeningId(event.target.value)}
                disabled={submitting}
              >
                <option value="">No opening preset</option>
                {availableOpenings.map((opening) => (
                  <option key={opening.id} value={opening.id}>
                    {opening.name} ({opening.style})
                  </option>
                ))}
              </select>
            </label>

            <p className="setup-hint">
              {gameMode === 'act_as_ai' && !access.canUseBestMove
                ? 'Best Move is premium. Upgrade to unlock full Stockfish play.'
                : `AI side: ${aiSide}. Only matching openings are shown.`}
            </p>

            <div className="action-row">
              <button
                className="primary"
                onClick={handleStartGame}
                disabled={
                  !selectedUserId ||
                  submitting ||
                  (gameMode === 'act_as_ai' && !access.canUseBestMove)
                }
                type="button"
              >
                New game
              </button>

              <button
                className="secondary danger"
                onClick={handleResign}
                disabled={!game || game.status !== 'active' || submitting}
                type="button"
              >
                Resign
              </button>
            </div>

            {gameMode === 'act_as_ai' && !access.canUseBestMove ? (
              <button
                className="secondary full-width"
                type="button"
                disabled={submitting}
                onClick={handleUpgrade}
              >
                Upgrade for Best Move
              </button>
            ) : null}
          </div>

          {selectedUser ? (
            <div className="panel">
              <div className="panel-heading">
                <h2>{selectedUser.name}</h2>
                <p>
                  {account.isGuest
                    ? `Guest profile capped at ${access.maxAdaptiveRating}.`
                    : access.plan === 'premium'
                      ? 'Premium adaptive profile.'
                      : `Free profile capped at ${access.maxAdaptiveRating}.`}
                </p>
              </div>

              <dl className="stats-grid">
                <div>
                  <dt>Target rating</dt>
                  <dd>{selectedUser.targetAiRating}</dd>
                </div>
                <div>
                  <dt>Games</dt>
                  <dd>{selectedUser.gamesPlayed}</dd>
                </div>
                <div>
                  <dt>Wins</dt>
                  <dd>{selectedUser.wins}</dd>
                </div>
                <div>
                  <dt>Losses</dt>
                  <dd>{selectedUser.losses}</dd>
                </div>
                <div>
                  <dt>Draws</dt>
                  <dd>{selectedUser.draws}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </aside>

        <section className="board-column">
          <div className="status-bar">
            <div className="status-main">
              <p className="status-label">Status</p>
              <h2>{formatTurn(game)}</h2>
            </div>
            <div className="status-meta">
              <span>{formatOpeningStatus(game)}</span>
              <span>{game?.engineLabel ?? 'Engine idle'}</span>
            </div>
            <div className="status-chip">
              <span>{game?.mode === 'act_as_ai' ? 'Mode' : 'Result'}</span>
              <strong>
                {game?.mode === 'act_as_ai'
                  ? 'Best Move'
                  : formatResult(game)}
              </strong>
            </div>
          </div>

          <div className="board-card">
            <div className="board-area">
              <div className="eval-bar-shell" aria-label="Board evaluation">
                <div className="eval-bar-track">
                  <div
                    className="eval-bar-fill eval-bar-black"
                    style={{
                      height: `${topFill * 100}%`,
                    }}
                  />
                  <div
                    className="eval-bar-fill eval-bar-white"
                    style={{
                      height: `${bottomFill * 100}%`,
                    }}
                  />
                  <div
                    className="eval-bar-marker"
                    style={{
                      bottom: `${bottomFill * 100}%`,
                    }}
                  />
                </div>
                <div className="eval-bar-labels">
                  <span>{topSide}</span>
                  <strong>{evaluation?.label ?? '0.0'}</strong>
                  <span>{bottomSide}</span>
                </div>
              </div>

              <div className="board-shell">
                <div className={`clock-banner ${topClockActive ? 'active' : ''}`}>
                  <span>{topClockLabel}</span>
                  <strong>{formatClock(topClockMs)}</strong>
                </div>
                <div className="mobile-board-hint">{boardHint}</div>
                <Chessboard
                  options={{
                    id: 'oscar-board',
                    position: boardFen,
                    boardOrientation,
                    squareStyles,
                    animationDurationInMs: 180,
                    allowDragging: canInteract,
                    canDragPiece: ({ square }) =>
                      Boolean(
                        canInteract &&
                          square &&
                          isHumanOwnedSquare(boardChess, square, activeHumanColor),
                      ),
                    onPieceClick: ({ square }) => {
                      if (!square) {
                        return
                      }
                      handleSquarePress(square)
                    },
                    onSquareClick: ({ square }) => {
                      handleSquarePress(square)
                    },
                    onPieceDrop: ({ sourceSquare, targetSquare }) => {
                      if (!targetSquare || !canInteract) {
                        return false
                      }

                      setSelectedSquare(null)
                      void submitMove(sourceSquare, targetSquare)
                      return true
                    },
                    boardStyle: {
                      borderRadius: '20px',
                      boxShadow: '0 18px 42px rgba(17, 18, 24, 0.18)',
                    },
                    darkSquareStyle: {
                      backgroundColor: '#7f4f24',
                    },
                    lightSquareStyle: {
                      backgroundColor: '#f6e7c8',
                    },
                    showNotation: true,
                  }}
                />
                <div className={`clock-banner bottom ${bottomClockActive ? 'active' : ''}`}>
                  <span>{bottomClockLabel}</span>
                  <strong>{formatClock(bottomClockMs)}</strong>
                </div>
              </div>
            </div>

            <div className="board-caption">
              <div className="caption-meta">
                <span>
                  {game
                    ? game.openingName
                      ? formatOpeningStatus(game)
                      : game.mode === 'act_as_ai'
                        ? 'Premium Best Move active'
                        : `Adaptive rating ${game.adaptiveRating} / cap ${access.maxAdaptiveRating}`
                    : 'Start a game to load the board'}
                </span>
                <span>
                  {game
                    ? `Clock ${game.timeControl.replace('_', ' | ')}`
                    : submitting
                      ? 'Submitting move...'
                      : boardHint}
                </span>
              </div>
              <div className="toolbar-actions">
                <button
                  className="secondary switch-view"
                  disabled={!canUndo}
                  onClick={handleUndo}
                  type="button"
                >
                  Undo
                </button>
                <button
                  className="secondary switch-view"
                  onClick={() => setIsBoardFlipped((current) => !current)}
                  type="button"
                >
                  Switch view
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="details-column">
          <div className="panel">
            <div className="panel-heading">
              <h2>Game Feed</h2>
              <p>Move list, plan gating, and position metadata.</p>
            </div>

            <div className="result-card">
              <div>
                <span>Plan</span>
                <strong>{access.plan === 'premium' ? 'Premium' : 'Free'}</strong>
              </div>
              <div>
                <span>{game?.mode === 'act_as_ai' ? 'Engine' : 'Adaptive cap'}</span>
                <strong>
                  {game?.mode === 'act_as_ai'
                    ? 'Stockfish'
                    : access.maxAdaptiveRating}
                </strong>
              </div>
              <div>
                <span>Games left today</span>
                <strong>
                  {access.remainingFreeGamesToday == null
                    ? 'Unlimited'
                    : access.remainingFreeGamesToday}
                </strong>
              </div>
            </div>

            <div className="message-stack">
              {error ? <p className="banner error">{error}</p> : null}
              {message ? <p className="banner info">{message}</p> : null}
            </div>

            <div className="move-list">
              {game?.moveHistory.length ? (
                game.moveHistory.map((move) => (
                  <div className="move-row" key={move.ply}>
                    <span>{move.ply}.</span>
                    <strong>{move.san}</strong>
                    <small>{move.actor === 'human' ? 'You' : 'Oscar'}</small>
                  </div>
                ))
              ) : (
                <p className="muted">Moves will appear here after the first turn.</p>
              )}
            </div>

            {game?.pgn ? (
              <label className="field">
                <span>PGN</span>
                <textarea readOnly value={game.pgn} rows={7} />
              </label>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  )
}

export default App
