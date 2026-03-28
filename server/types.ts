export type PlayerColor = 'white' | 'black'
export type GameMode = 'adaptive' | 'act_as_ai'
export type OpeningStatus = 'none' | 'following' | 'broken'

export type GameStatus =
  | 'active'
  | 'checkmate'
  | 'stalemate'
  | 'draw'
  | 'resigned'

export type GameResult = 'human_win' | 'ai_win' | 'draw' | null

export type MoveEntry = {
  ply: number
  actor: 'human' | 'ai'
  san: string
  from: string
  to: string
}

export type Evaluation = {
  scoreCp: number | null
  mateIn: number | null
  advantage: number
  label: string
}

export type UserRecord = {
  id: string
  name: string
  targetAiRating: number
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
  createdAt: string
  updatedAt: string
}

export type GameRecord = {
  id: string
  userId: string
  mode: GameMode
  openingId: string | null
  openingName: string | null
  openingSide: PlayerColor | null
  openingStatus: OpeningStatus
  humanColor: PlayerColor
  aiColor: PlayerColor
  status: GameStatus
  result: GameResult
  fen: string
  pgn: string
  moveHistory: MoveEntry[]
  positionHistory: string[]
  adaptiveRating: number
  startingRating: number
  ratingDelta: number | null
  engineLabel: string
  createdAt: string
  updatedAt: string
}

export type Database = {
  users: UserRecord[]
  games: GameRecord[]
}
