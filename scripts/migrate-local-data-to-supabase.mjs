import { config as loadEnv } from 'dotenv'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

loadEnv({ path: '.env.local' })
loadEnv()

const supabaseUrl =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const raw = await readFile(new URL('../data/oscar-db.json', import.meta.url), 'utf8')
const database = JSON.parse(raw)

const accountRows = (database.accounts ?? []).map((account) => ({
  id: account.id,
  auth_user_id: null,
  email: account.email,
  is_guest: account.isGuest ?? false,
  plan: account.plan ?? 'free',
  subscription_status: account.subscriptionStatus ?? 'inactive',
  stripe_customer_id: account.stripeCustomerId ?? null,
  stripe_subscription_id: account.stripeSubscriptionId ?? null,
  games_used_today: account.gamesUsedToday ?? 0,
  usage_window_started_at: account.usageWindowStartedAt ?? account.createdAt,
  created_at: account.createdAt,
  updated_at: account.updatedAt,
}))

const existingAccountIds = new Set(accountRows.map((account) => account.id))
const inferredLegacyAccountRows = (database.users ?? [])
  .filter((user) => !existingAccountIds.has(user.accountId ?? user.id))
  .map((user) => ({
    id: user.accountId ?? user.id,
    auth_user_id: null,
    email: `legacy+${user.accountId ?? user.id}@oscar.local`,
    is_guest: true,
    plan: 'free',
    subscription_status: 'inactive',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    games_used_today: 0,
    usage_window_started_at: user.createdAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  }))
const allAccountRows = [...accountRows, ...inferredLegacyAccountRows]

const userRows = (database.users ?? []).map((user) => ({
  id: user.id,
  account_id: user.accountId ?? user.id,
  name: user.name,
  target_ai_rating: user.targetAiRating ?? 100,
  games_played: user.gamesPlayed ?? 0,
  wins: user.wins ?? 0,
  losses: user.losses ?? 0,
  draws: user.draws ?? 0,
  created_at: user.createdAt,
  updated_at: user.updatedAt,
}))

const gameRows = (database.games ?? []).map((game) => ({
  id: game.id,
  user_id: game.userId,
  mode: game.mode ?? 'adaptive',
  time_control: game.timeControl ?? '15_0',
  initial_time_ms: game.initialTimeMs ?? 900000,
  increment_ms: game.incrementMs ?? 0,
  white_time_ms: game.whiteTimeMs ?? (game.initialTimeMs ?? 900000),
  black_time_ms: game.blackTimeMs ?? (game.initialTimeMs ?? 900000),
  active_turn_started_at: game.activeTurnStartedAt ?? game.updatedAt ?? null,
  opening_id: game.openingId ?? null,
  opening_name: game.openingName ?? null,
  opening_side: game.openingSide ?? null,
  opening_status: game.openingStatus ?? 'none',
  human_color: game.humanColor,
  ai_color: game.aiColor,
  status: game.status,
  result: game.result ?? null,
  fen: game.fen,
  pgn: game.pgn ?? '',
  move_history: game.moveHistory ?? [],
  position_history: game.positionHistory ?? [],
  adaptive_rating: game.adaptiveRating ?? 100,
  starting_rating: game.startingRating ?? 100,
  rating_delta: game.ratingDelta ?? null,
  engine_label: game.engineLabel ?? 'Oscar Lite',
  created_at: game.createdAt,
  updated_at: game.updatedAt,
}))

const sessionRows = (database.sessions ?? []).map((session) => ({
  id: session.id,
  account_id: session.accountId,
  expires_at: session.expiresAt,
  created_at: session.createdAt,
}))

for (const [table, rows] of [
  ['oscar_accounts', allAccountRows],
  ['oscar_profiles', userRows],
  ['oscar_games', gameRows],
  ['oscar_sessions', sessionRows],
]) {
  if (!rows.length) {
    continue
  }

  const { error } = await supabase.from(table).upsert(rows)
  if (error) {
    throw error
  }
}

console.log('Migrated local Oscar data to Supabase.')
