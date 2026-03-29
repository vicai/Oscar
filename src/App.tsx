import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Chess } from 'chess.js'
import type { Move, Square } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import './App.css'

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

type GameView = {
  id: string
  userId: string
  mode: GameMode
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
}

const api = {
  async getUsers() {
    const response = await fetch('/api/users')
    if (!response.ok) {
      throw new Error('Failed to load profiles.')
    }
    return (await response.json()) as { users: User[] }
  },
  async createUser(name: string) {
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as
        | { error?: string }
        | null
      throw new Error(error?.error ?? 'Failed to create profile.')
    }

    return (await response.json()) as { user: User }
  },
  async getOpenings() {
    const response = await fetch('/api/openings')
    if (!response.ok) {
      throw new Error('Failed to load openings.')
    }
    return (await response.json()) as { openings: Opening[] }
  },
  async startGame(
    userId: string,
    humanColor: 'white' | 'black',
    mode: GameMode,
    openingId: string | null,
  ) {
    const response = await fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, humanColor, mode, openingId }),
    })

    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as
        | { error?: string }
        | null
      throw new Error(error?.error ?? 'Failed to start a game.')
    }

    return (await response.json()) as GameResponse
  },
  async makeMove(gameId: string, from: string, to: string) {
    const response = await fetch(`/api/games/${gameId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, promotion: 'q' }),
    })

    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as
        | { error?: string }
        | null
      throw new Error(error?.error ?? 'Move rejected.')
    }

    return (await response.json()) as GameResponse
  },
  async resign(gameId: string) {
    const response = await fetch(`/api/games/${gameId}/resign`, {
      method: 'POST',
    })

    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as
        | { error?: string }
        | null
      throw new Error(error?.error ?? 'Failed to resign.')
    }

    return (await response.json()) as GameResponse
  },
  async undo(gameId: string) {
    const response = await fetch(`/api/games/${gameId}/undo`, {
      method: 'POST',
    })

    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as
        | { error?: string }
        | null
      throw new Error(error?.error ?? 'Failed to undo the last turn.')
    }

    return (await response.json()) as GameResponse
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
      : 'Oscar is thinking'
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

function App() {
  const [users, setUsers] = useState<User[]>([])
  const [openings, setOpenings] = useState<Opening[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [newUserName, setNewUserName] = useState('')
  const [game, setGame] = useState<GameView | null>(null)
  const [humanColor, setHumanColor] = useState<'white' | 'black'>('white')
  const [gameMode, setGameMode] = useState<GameMode>('act_as_ai')
  const [selectedOpeningId, setSelectedOpeningId] = useState<string>('')
  const [isBoardFlipped, setIsBoardFlipped] = useState(false)
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [error, setError] = useState<string>('')

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
    void (async () => {
      try {
        const data = await api.getUsers()
        const openingData = await api.getOpenings()
        setUsers(data.users)
        setOpenings(openingData.openings)
        if (data.users[0]) {
          setSelectedUserId(data.users[0].id)
        }
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Failed to load profiles.',
        )
      } finally {
        setLoadingUsers(false)
      }
    })()
  }, [])

  async function refreshUsers(selectId?: string) {
    const data = await api.getUsers()
    setUsers(data.users)
    if (selectId) {
      setSelectedUserId(selectId)
      return
    }

    if (!selectedUserId && data.users[0]) {
      setSelectedUserId(data.users[0].id)
    }
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
      await refreshUsers(data.user.id)
      setNewUserName('')
      setGame(null)
      setEvaluation(null)
      setMessage(`Created profile for ${data.user.name}.`)
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
        selectedOpeningId || null,
      )
      setGame(data.game)
      setEvaluation(data.evaluation)
      setMessage(
        data.game.openingName
          ? `${data.user.name} started with ${data.game.openingName}.`
          : gameMode === 'act_as_ai'
            ? `${data.user.name} is now playing in Best Move mode.`
            : `${data.user.name} is now facing Oscar at adaptive rating ${data.user.targetAiRating}.`,
      )
      await refreshUsers(data.user.id)
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
      setMessage(
        game.mode === 'act_as_ai'
          ? `${data.user.name}'s profile rating was unchanged in Best Move mode.`
          : `${data.user.name}'s adaptive rating is now ${data.user.targetAiRating}.`,
      )
      await refreshUsers(data.user.id)
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
      setMessage(
        data.game.status === 'active'
          ? data.game.mode === 'act_as_ai'
            ? `${data.user.name} is receiving Stockfish's strongest replies.`
            : `${data.user.name}'s target rating remains ${data.user.targetAiRating}.`
          : data.game.mode === 'act_as_ai'
            ? `${formatResult(data.game)}. Profile rating unchanged in Best Move mode.`
            : `${formatResult(data.game)}. Adaptive rating: ${data.user.targetAiRating}.`,
      )
      await refreshUsers(data.user.id)
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
      setMessage('Last turn undone.')
      await refreshUsers(data.user.id)
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
        const occupied = Boolean(boardChess?.get(square))
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

  return (
    <main className="shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Oscar Chess Workspace</p>
          <h1>Board-first chess with openings, engine control, and best-move play.</h1>
          <p className="hero-text">
            Pick a profile, choose how the engine behaves, and keep the board as
            the center of attention.
          </p>
        </div>

        <div className="hero-stats">
          <div className="stat-card">
            <span>Profiles</span>
            <strong>{users.length}</strong>
          </div>
          <div className="stat-card">
            <span>{gameMode === 'act_as_ai' ? 'Mode' : 'Selected Rating'}</span>
            <strong>
              {gameMode === 'act_as_ai'
                ? 'Best Move'
                : selectedUser?.targetAiRating ?? 100}
            </strong>
          </div>
          <div className="stat-card">
            <span>Engine</span>
            <strong>
              {game?.openingName ??
                game?.engineLabel ??
                (gameMode === 'act_as_ai'
                  ? 'Stockfish 18 Best Move'
                  : 'Stockfish 18 Lite')}
            </strong>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel">
            <div className="panel-heading">
              <h2>Profiles</h2>
              <p>Separate adaptive ladders for each local player.</p>
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
              {loadingUsers ? (
                <p className="muted">Loading profiles...</p>
              ) : users.length === 0 ? (
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
              <p>Human vs AI only, no clock, with adaptive or best-move play.</p>
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
              AI side: {aiSide}. Only matching openings are shown.
            </p>

            <div className="action-row">
              <button
                className="primary"
                onClick={handleStartGame}
                disabled={!selectedUserId || submitting}
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
          </div>

          {selectedUser ? (
            <div className="panel">
              <div className="panel-heading">
                <h2>{selectedUser.name}</h2>
                <p>Current adaptive difficulty profile.</p>
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
              </div>
            </div>

            <div className="board-caption">
              <div className="caption-meta">
                <span>
                  {game
                    ? game.openingName
                      ? formatOpeningStatus(game)
                      : game.mode === 'act_as_ai'
                        ? 'Best Move mode active'
                        : `Adaptive rating ${game.adaptiveRating}`
                    : 'Start a game to load the board'}
                </span>
                <span>
                  {submitting ? 'Submitting move...' : boardHint}
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
              <p>Move list, rating shifts, and position metadata.</p>
            </div>

            <div className="result-card">
              <div>
                <span>{game?.openingName ? 'Opening' : 'Starting rating'}</span>
                <strong>
                  {game?.openingName
                    ? game.openingName
                    : game?.mode === 'act_as_ai'
                    ? 'N/A'
                    : game?.startingRating ?? selectedUser?.targetAiRating ?? 100}
                </strong>
              </div>
              <div>
                <span>{game?.mode === 'act_as_ai' ? 'Profile rating' : 'Current rating'}</span>
                <strong>{selectedUser?.targetAiRating ?? 100}</strong>
              </div>
              <div>
                <span>{game?.mode === 'act_as_ai' ? 'Rating impact' : 'Last delta'}</span>
                <strong>
                  {game?.mode === 'act_as_ai'
                    ? 'None'
                    : game?.ratingDelta == null
                    ? 'Pending'
                    : game.ratingDelta >= 0
                      ? `+${game.ratingDelta}`
                      : `${game.ratingDelta}`}
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
