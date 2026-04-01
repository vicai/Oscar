import type {
  AccountRecord,
  GameRecord,
  SessionRecord,
  UserRecord,
} from './types.js'
import { createSupabaseAdminClient } from './supabase.js'

type AccountRow = {
  id: string
  auth_user_id: string | null
  email: string
  is_guest: boolean
  plan: AccountRecord['plan']
  subscription_status: AccountRecord['subscriptionStatus']
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  games_used_today: number
  usage_window_started_at: string
  created_at: string
  updated_at: string
}

type SessionRow = {
  id: string
  account_id: string
  expires_at: string
  created_at: string
}

type UserRow = {
  id: string
  account_id: string
  name: string
  target_ai_rating: number
  games_played: number
  wins: number
  losses: number
  draws: number
  created_at: string
  updated_at: string
}

type GameRow = {
  id: string
  user_id: string
  mode: GameRecord['mode']
  time_control: GameRecord['timeControl']
  initial_time_ms: number
  increment_ms: number
  white_time_ms: number
  black_time_ms: number
  active_turn_started_at: string | null
  opening_id: string | null
  opening_name: string | null
  opening_side: GameRecord['openingSide']
  opening_status: GameRecord['openingStatus']
  human_color: GameRecord['humanColor']
  ai_color: GameRecord['aiColor']
  status: GameRecord['status']
  result: GameRecord['result']
  fen: string
  pgn: string
  move_history: GameRecord['moveHistory']
  position_history: GameRecord['positionHistory']
  adaptive_rating: number
  starting_rating: number
  rating_delta: number | null
  engine_label: string
  created_at: string
  updated_at: string
}

function mapAccountRow(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email.toLowerCase(),
    isGuest: row.is_guest,
    passwordHash: '',
    passwordSalt: '',
    plan: row.plan,
    subscriptionStatus: row.subscription_status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    gamesUsedToday: row.games_used_today,
    usageWindowStartedAt: row.usage_window_started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

function mapUserRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    targetAiRating: row.target_ai_rating,
    gamesPlayed: row.games_played,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapGameRow(row: GameRow): GameRecord {
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    timeControl: row.time_control,
    initialTimeMs: row.initial_time_ms,
    incrementMs: row.increment_ms,
    whiteTimeMs: row.white_time_ms,
    blackTimeMs: row.black_time_ms,
    activeTurnStartedAt: row.active_turn_started_at,
    openingId: row.opening_id,
    openingName: row.opening_name,
    openingSide: row.opening_side,
    openingStatus: row.opening_status,
    humanColor: row.human_color,
    aiColor: row.ai_color,
    status: row.status,
    result: row.result,
    fen: row.fen,
    pgn: row.pgn,
    moveHistory: row.move_history ?? [],
    positionHistory: row.position_history ?? [],
    adaptiveRating: row.adaptive_rating,
    startingRating: row.starting_rating,
    ratingDelta: row.rating_delta,
    engineLabel: row.engine_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function accountRowFromRecord(account: AccountRecord): AccountRow {
  return {
    id: account.id,
    auth_user_id: account.authUserId,
    email: account.email.toLowerCase(),
    is_guest: account.isGuest,
    plan: account.plan,
    subscription_status: account.subscriptionStatus,
    stripe_customer_id: account.stripeCustomerId,
    stripe_subscription_id: account.stripeSubscriptionId,
    games_used_today: account.gamesUsedToday,
    usage_window_started_at: account.usageWindowStartedAt,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  }
}

function sessionRowFromRecord(session: SessionRecord): SessionRow {
  return {
    id: session.id,
    account_id: session.accountId,
    expires_at: session.expiresAt,
    created_at: session.createdAt,
  }
}

function userRowFromRecord(user: UserRecord): UserRow {
  return {
    id: user.id,
    account_id: user.accountId,
    name: user.name,
    target_ai_rating: user.targetAiRating,
    games_played: user.gamesPlayed,
    wins: user.wins,
    losses: user.losses,
    draws: user.draws,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  }
}

function gameRowFromRecord(game: GameRecord): GameRow {
  return {
    id: game.id,
    user_id: game.userId,
    mode: game.mode,
    time_control: game.timeControl,
    initial_time_ms: game.initialTimeMs,
    increment_ms: game.incrementMs,
    white_time_ms: game.whiteTimeMs,
    black_time_ms: game.blackTimeMs,
    active_turn_started_at: game.activeTurnStartedAt,
    opening_id: game.openingId,
    opening_name: game.openingName,
    opening_side: game.openingSide,
    opening_status: game.openingStatus,
    human_color: game.humanColor,
    ai_color: game.aiColor,
    status: game.status,
    result: game.result,
    fen: game.fen,
    pgn: game.pgn,
    move_history: game.moveHistory,
    position_history: game.positionHistory,
    adaptive_rating: game.adaptiveRating,
    starting_rating: game.startingRating,
    rating_delta: game.ratingDelta,
    engine_label: game.engineLabel,
    created_at: game.createdAt,
    updated_at: game.updatedAt,
  }
}

export async function getAccountById(accountId: string) {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_accounts')
    .select('*')
    .eq('id', accountId)
    .maybeSingle<AccountRow>()

  if (error) {
    throw error
  }

  return data ? mapAccountRow(data) : null
}

export async function getAccountByAuthUserId(authUserId: string) {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_accounts')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle<AccountRow>()

  if (error) {
    throw error
  }

  return data ? mapAccountRow(data) : null
}

export async function getAccountByEmail(email: string) {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_accounts')
    .select('*')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle<AccountRow>()

  if (error) {
    throw error
  }

  return data ? mapAccountRow(data) : null
}

export async function createAccount(account: AccountRecord) {
  const supabase = createSupabaseAdminClient()
  const row = accountRowFromRecord(account)
  const { data, error } = await supabase
    .from('oscar_accounts')
    .insert(row)
    .select('*')
    .single<AccountRow>()

  if (error) {
    throw error
  }

  return mapAccountRow(data)
}

export async function upsertAccount(account: AccountRecord) {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_accounts')
    .upsert(accountRowFromRecord(account))
    .select('*')
    .single<AccountRow>()

  if (error) {
    throw error
  }

  return mapAccountRow(data)
}

export async function updateAccount(
  accountId: string,
  updater: (account: AccountRecord) => AccountRecord,
) {
  const current = await getAccountById(accountId)
  if (!current) {
    throw new Error('Account not found.')
  }

  const next = updater(current)
  return upsertAccount(next)
}

export async function createSession(session: SessionRecord) {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_sessions')
    .upsert(sessionRowFromRecord(session))
    .select('*')
    .single<SessionRow>()

  if (error) {
    throw error
  }

  return mapSessionRow(data)
}

export async function getSession(sessionId: string) {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle<SessionRow>()

  if (error) {
    throw error
  }

  return data ? mapSessionRow(data) : null
}

export async function deleteSession(sessionId: string) {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('oscar_sessions')
    .delete()
    .eq('id', sessionId)

  if (error) {
    throw error
  }
}

export async function listUsersForAccount(accountId: string) {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_profiles')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .returns<UserRow[]>()

  if (error) {
    throw error
  }

  return (data ?? []).map(mapUserRow)
}

export async function createUser(accountId: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Profile name is required.')
  }

  const now = new Date().toISOString()
  const user: UserRecord = {
    id: crypto.randomUUID(),
    accountId,
    name: trimmed,
    targetAiRating: 100,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    createdAt: now,
    updatedAt: now,
  }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_profiles')
    .insert(userRowFromRecord(user))
    .select('*')
    .single<UserRow>()

  if (error) {
    throw error
  }

  return mapUserRow(data)
}

export async function getUser(userId: string) {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle<UserRow>()

  if (error) {
    throw error
  }

  return data ? mapUserRow(data) : null
}

export async function updateUser(userId: string, updater: (user: UserRecord) => UserRecord) {
  const current = await getUser(userId)
  if (!current) {
    throw new Error('Profile not found.')
  }

  const next = updater(current)
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_profiles')
    .upsert(userRowFromRecord(next))
    .select('*')
    .single<UserRow>()

  if (error) {
    throw error
  }

  return mapUserRow(data)
}

export async function createGame(game: GameRecord) {
  const supabase = createSupabaseAdminClient()
  const { error: clearError } = await supabase
    .from('oscar_games')
    .update({
      status: 'resigned',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', game.userId)
    .eq('status', 'active')

  if (clearError) {
    throw clearError
  }

  const { data, error } = await supabase
    .from('oscar_games')
    .insert(gameRowFromRecord(game))
    .select('*')
    .single<GameRow>()

  if (error) {
    throw error
  }

  return mapGameRow(data)
}

export async function getGame(gameId: string) {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle<GameRow>()

  if (error) {
    throw error
  }

  return data ? mapGameRow(data) : null
}

export async function updateGame(
  gameId: string,
  updater: (game: GameRecord) => GameRecord,
) {
  const current = await getGame(gameId)
  if (!current) {
    throw new Error('Game not found.')
  }

  const next = updater(current)
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('oscar_games')
    .upsert(gameRowFromRecord(next))
    .select('*')
    .single<GameRow>()

  if (error) {
    throw error
  }

  return mapGameRow(data)
}
