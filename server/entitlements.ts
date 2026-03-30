import { updateAccount } from './store.js'
import type { AccountRecord } from './types.js'

export const FREE_DAILY_GAME_CAP = Number(process.env.FREE_DAILY_GAME_CAP ?? 5)
export const FREE_RATING_CAP = Number(process.env.FREE_RATING_CAP ?? 2000)
const PREMIUM_EMAILS = new Set(
  (process.env.PREMIUM_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
)

function isPremiumAccount(account: AccountRecord) {
  return (
    account.plan === 'premium' ||
    account.subscriptionStatus === 'active' ||
    account.subscriptionStatus === 'trialing' ||
    PREMIUM_EMAILS.has(account.email)
  )
}

export async function refreshUsageWindow(account: AccountRecord) {
  const windowStartedAt = new Date(account.usageWindowStartedAt).getTime()
  const isExpired = Date.now() - windowStartedAt >= 24 * 60 * 60 * 1000

  if (!isExpired) {
    return account
  }

  return updateAccount(account.id, (currentAccount) => ({
    ...currentAccount,
    gamesUsedToday: 0,
    usageWindowStartedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))
}

export async function buildAccessState(account: AccountRecord) {
  const freshAccount = await refreshUsageWindow(account)
  const premium = isPremiumAccount(freshAccount)
  const remainingFreeGamesToday = premium
    ? null
    : Math.max(0, FREE_DAILY_GAME_CAP - freshAccount.gamesUsedToday)

  return {
    account: freshAccount,
    access: {
      plan: premium ? 'premium' : 'free',
      subscriptionStatus: premium ? 'active' : freshAccount.subscriptionStatus,
      canUseBestMove: true,
      maxAdaptiveRating: premium ? 3200 : FREE_RATING_CAP,
      freeDailyGameCap: FREE_DAILY_GAME_CAP,
      remainingFreeGamesToday,
      upgradeCtaLabel: premium ? null : '$1.99/month for unlimited games and stronger adaptive play',
    },
  }
}

export async function consumeGameStart(account: AccountRecord) {
  const { account: freshAccount, access } = await buildAccessState(account)

  if (access.plan === 'free' && (access.remainingFreeGamesToday ?? 0) <= 0) {
    throw new Error('Free plan daily game cap reached. Upgrade to keep playing.')
  }

  if (access.plan === 'premium') {
    return { account: freshAccount, access }
  }

  const updatedAccount = await updateAccount(freshAccount.id, (currentAccount) => ({
    ...currentAccount,
    gamesUsedToday: currentAccount.gamesUsedToday + 1,
    updatedAt: new Date().toISOString(),
  }))

  return buildAccessState(updatedAccount)
}
