import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import {
  createAccount,
  createSession,
  deleteSession,
  getAccountByEmail,
  getAccountById,
  getSession,
} from './store.js'
import type { AccountRecord, SessionRecord } from './types.js'

const SESSION_COOKIE_NAME = 'oscar_session'
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000

function parseCookies(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return {}
  }

  return Object.fromEntries(
    cookieHeader.split(';').map((part) => {
      const [key, ...rest] = part.trim().split('=')
      return [key, decodeURIComponent(rest.join('='))]
    }),
  )
}

function buildCookieValue(sessionId: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`
}

export function clearSessionCookie(response: Response) {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(0).toUTCString()}`,
  )
}

export async function registerAccount(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('A valid email is required.')
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }

  const existing = await getAccountByEmail(normalizedEmail)
  if (existing) {
    throw new Error('That email is already in use.')
  }

  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex')
  const now = new Date().toISOString()

  const account: AccountRecord = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    isGuest: false,
    passwordHash,
    passwordSalt: salt,
    plan: 'free',
    subscriptionStatus: 'inactive',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    gamesUsedToday: 0,
    usageWindowStartedAt: now,
    createdAt: now,
    updatedAt: now,
  }

  return createAccount(account)
}

export async function createGuestAccount() {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  const account: AccountRecord = {
    id,
    email: `guest+${id}@oscar.local`,
    isGuest: true,
    passwordHash: '',
    passwordSalt: '',
    plan: 'free',
    subscriptionStatus: 'inactive',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    gamesUsedToday: 0,
    usageWindowStartedAt: now,
    createdAt: now,
    updatedAt: now,
  }

  return createAccount(account)
}

export async function authenticateAccount(email: string, password: string) {
  const account = await getAccountByEmail(email)
  if (!account) {
    throw new Error('Invalid email or password.')
  }

  const passwordHash = crypto
    .scryptSync(password, account.passwordSalt, 64)
    .toString('hex')

  if (passwordHash !== account.passwordHash) {
    throw new Error('Invalid email or password.')
  }

  return account
}

export async function createSessionForAccount(accountId: string, response: Response) {
  const now = Date.now()
  const expiresAt = new Date(now + SESSION_DURATION_MS)
  const session: SessionRecord = {
    id: crypto.randomUUID(),
    accountId,
    createdAt: new Date(now).toISOString(),
    expiresAt: expiresAt.toISOString(),
  }

  await createSession(session)
  response.setHeader('Set-Cookie', buildCookieValue(session.id, expiresAt))
  return session
}

export async function getAuthenticatedAccount(request: Request) {
  const cookies = parseCookies(request.headers.cookie)
  const sessionId = cookies[SESSION_COOKIE_NAME]
  if (!sessionId) {
    return null
  }

  const session = await getSession(sessionId)
  if (!session) {
    return null
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteSession(session.id)
    return null
  }

  const account = await getAccountById(session.accountId)
  if (!account) {
    await deleteSession(session.id)
    return null
  }

  return { account, sessionId: session.id }
}

export async function signOut(request: Request, response: Response) {
  const cookies = parseCookies(request.headers.cookie)
  const sessionId = cookies[SESSION_COOKIE_NAME]
  if (sessionId) {
    await deleteSession(sessionId)
  }
  clearSessionCookie(response)
}
