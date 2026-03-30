export type PlayerColor = 'white' | 'black'
export type GameMode = 'adaptive' | 'act_as_ai'
export type OpeningStatus = 'none' | 'following' | 'broken'
export type AccountPlan = 'free' | 'premium'
export type SubscriptionStatus =
  | 'inactive'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'

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

export type AccountRecord = {
  id: string
  email: string
  isGuest: boolean
  passwordHash: string
  passwordSalt: string
  plan: AccountPlan
  subscriptionStatus: SubscriptionStatus
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  gamesUsedToday: number
  usageWindowStartedAt: string
  createdAt: string
  updatedAt: string
}

export type SessionRecord = {
  id: string
  accountId: string
  expiresAt: string
  createdAt: string
}

export type UserRecord = {
  id: string
  accountId: string
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
  accounts: AccountRecord[]
  sessions: SessionRecord[]
  users: UserRecord[]
  games: GameRecord[]
}
