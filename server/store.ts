import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Chess } from 'chess.js'
import type {
  Database,
  GameMode,
  GameRecord,
  OpeningStatus,
  PlayerColor,
  UserRecord,
} from './types.js'

const dataDirectory = process.env.DATA_DIR
  ? resolve(process.env.DATA_DIR)
  : resolve(process.cwd(), 'data')
const DATA_FILE = resolve(dataDirectory, 'oscar-db.json')

const emptyDatabase: Database = {
  users: [],
  games: [],
}

function buildPositionHistoryFromMoves(moveHistory: GameRecord['moveHistory']) {
  const chess = new Chess()
  const history = [chess.fen()]

  for (const move of moveHistory) {
    const applied = chess.move({
      from: move.from,
      to: move.to,
      promotion: 'q',
    })

    if (!applied) {
      return [history[0]]
    }

    history.push(chess.fen())
  }

  return history
}

function normalizeGameRecord(
  game: Omit<
    GameRecord,
    'mode' | 'positionHistory' | 'openingId' | 'openingName' | 'openingSide' | 'openingStatus'
  > & {
    mode?: GameMode
    positionHistory?: string[]
    openingId?: string | null
    openingName?: string | null
    openingSide?: PlayerColor | null
    openingStatus?: OpeningStatus
  },
): GameRecord {
  const fallbackHistory =
    game.positionHistory && game.positionHistory.length > 0
      ? game.positionHistory
      : buildPositionHistoryFromMoves(game.moveHistory)

  return {
    ...game,
    mode: game.mode ?? 'adaptive',
    positionHistory: fallbackHistory,
    openingId: game.openingId ?? null,
    openingName: game.openingName ?? null,
    openingSide: game.openingSide ?? null,
    openingStatus: game.openingStatus ?? 'none',
  }
}

async function ensureDataFile() {
  await mkdir(dirname(DATA_FILE), { recursive: true })

  try {
    await readFile(DATA_FILE, 'utf8')
  } catch {
    await writeFile(DATA_FILE, JSON.stringify(emptyDatabase, null, 2), 'utf8')
  }
}

async function readDatabase(): Promise<Database> {
  await ensureDataFile()
  const raw = await readFile(DATA_FILE, 'utf8')
  const parsed = JSON.parse(raw) as Database & {
    games: Array<
      Omit<GameRecord, 'mode' | 'positionHistory'> & {
        openingId?: string | null
        openingName?: string | null
        openingSide?: PlayerColor | null
        openingStatus?: OpeningStatus
        mode?: GameMode
        positionHistory?: string[]
      }
    >
  }
  return {
    users: parsed.users,
    games: parsed.games.map(normalizeGameRecord),
  }
}

async function writeDatabase(database: Database) {
  await ensureDataFile()
  await writeFile(DATA_FILE, JSON.stringify(database, null, 2), 'utf8')
}

export async function listUsers() {
  const database = await readDatabase()
  return database.users.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
}

export async function createUser(name: string) {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Profile name is required.')
  }

  const database = await readDatabase()
  const now = new Date().toISOString()

  const user: UserRecord = {
    id: crypto.randomUUID(),
    name: trimmed,
    targetAiRating: 100,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    createdAt: now,
    updatedAt: now,
  }

  database.users.push(user)
  await writeDatabase(database)
  return user
}

export async function getUser(userId: string) {
  const database = await readDatabase()
  return database.users.find((user) => user.id === userId) ?? null
}

export async function updateUser(userId: string, updater: (user: UserRecord) => UserRecord) {
  const database = await readDatabase()
  const index = database.users.findIndex((user) => user.id === userId)
  if (index === -1) {
    throw new Error('Profile not found.')
  }

  const updated = updater(database.users[index])
  database.users[index] = updated
  await writeDatabase(database)
  return updated
}

export async function createGame(game: GameRecord) {
  const database = await readDatabase()
  database.games = database.games.filter(
    (existing) => !(existing.userId === game.userId && existing.status === 'active'),
  )
  database.games.push(game)
  await writeDatabase(database)
  return game
}

export async function getGame(gameId: string) {
  const database = await readDatabase()
  return database.games.find((game) => game.id === gameId) ?? null
}

export async function updateGame(
  gameId: string,
  updater: (game: GameRecord) => GameRecord,
) {
  const database = await readDatabase()
  const index = database.games.findIndex((game) => game.id === gameId)
  if (index === -1) {
    throw new Error('Game not found.')
  }

  const updated = updater(database.games[index])
  database.games[index] = updated
  await writeDatabase(database)
  return updated
}
