import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Evaluation } from './types.js'

type EngineSettings = {
  label: string
  multiPv: number
  skillLevel: number
  depth?: number
  movetime: number
  useLimitedStrength: boolean
  elo?: number
  temperature: number
}

type EngineMode = 'adaptive' | 'act_as_ai'

type CandidateMove = {
  move: string
  score: number
}

const require = createRequire(import.meta.url)
const stockfishPackage = require.resolve('stockfish/package.json')
const stockfishDir = dirname(stockfishPackage)
const engineScript = join(stockfishDir, 'bin', 'stockfish-18-lite-single.js')

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function randomChoice(weightedMoves: CandidateMove[]) {
  const totalWeight = weightedMoves.reduce((sum, move) => sum + move.score, 0)
  const threshold = Math.random() * totalWeight
  let running = 0

  for (const move of weightedMoves) {
    running += move.score
    if (running >= threshold) {
      return move.move
    }
  }

  return weightedMoves[0]?.move ?? null
}

function pickMove(candidates: CandidateMove[], fallback: string, temperature: number) {
  const uniqueCandidates = candidates.filter(
    (candidate, index, list) =>
      candidate.move &&
      list.findIndex((entry) => entry.move === candidate.move) === index,
  )

  if (uniqueCandidates.length <= 1) {
    return uniqueCandidates[0]?.move ?? fallback
  }

  const bestScore = Math.max(...uniqueCandidates.map((candidate) => candidate.score))
  const scaled = uniqueCandidates.map((candidate) => ({
    move: candidate.move,
    score: Math.exp((candidate.score - bestScore) / Math.max(temperature, 0.12)),
  }))

  return randomChoice(scaled) ?? fallback
}

function normalizeMateScore(value: number) {
  const base = 100000
  return value > 0 ? base - value * 1000 : -base - value * 1000
}

function parseCandidate(line: string) {
  const multipv = / multipv (\d+)/.exec(line)
  const pv = / pv ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(line)
  const cp = / score cp (-?\d+)/.exec(line)
  const mate = / score mate (-?\d+)/.exec(line)

  if (!multipv || !pv || (!cp && !mate)) {
    return null
  }

  return {
    rank: Number(multipv[1]),
    move: pv[1],
    score: cp ? Number(cp[1]) : normalizeMateScore(Number(mate![1])),
  }
}

function settingsForRating(targetAiRating: number): EngineSettings {
  const rating = clamp(targetAiRating, 100, 3200)

  if (rating < 500) {
    return {
      label: 'Stockfish 18 Lite',
      multiPv: 6,
      skillLevel: 0,
      movetime: 50,
      depth: 2,
      useLimitedStrength: false,
      temperature: 140,
    }
  }

  if (rating < 900) {
    return {
      label: 'Stockfish 18 Lite',
      multiPv: 5,
      skillLevel: 4,
      movetime: 90,
      depth: 4,
      useLimitedStrength: false,
      temperature: 110,
    }
  }

  if (rating < 1320) {
    return {
      label: 'Stockfish 18 Lite',
      multiPv: 4,
      skillLevel: 8,
      movetime: 160,
      depth: 6,
      useLimitedStrength: false,
      temperature: 80,
    }
  }

  if (rating < 2200) {
    return {
      label: 'Stockfish 18 Lite',
      multiPv: 3,
      skillLevel: 14,
      movetime: 280,
      depth: 10,
      useLimitedStrength: true,
      elo: clamp(rating, 1320, 2200),
      temperature: 32,
    }
  }

  return {
    label: 'Stockfish 18 Lite',
    multiPv: 2,
    skillLevel: 20,
    movetime: 480,
    depth: 13,
    useLimitedStrength: true,
    elo: clamp(rating, 2200, 3190),
    temperature: 12,
  }
}

function settingsForBestMove(): EngineSettings {
  return {
    label: 'Stockfish 18 Best Move',
    multiPv: 1,
    skillLevel: 20,
    movetime: 900,
    useLimitedStrength: false,
    temperature: 0,
  }
}

function formatEvaluation(scoreCp: number | null, mateIn: number | null): Evaluation {
  if (mateIn != null) {
    const sign = mateIn > 0 ? 1 : -1
    return {
      scoreCp,
      mateIn,
      advantage: sign > 0 ? 0.98 : 0.02,
      label: `M${Math.abs(mateIn)}`,
    }
  }

  const cp = scoreCp ?? 0
  const clamped = clamp(cp, -1200, 1200)
  const probability = 1 / (1 + Math.exp(-clamped / 220))
  const pawns = clamped / 100

  return {
    scoreCp: cp,
    mateIn: null,
    advantage: probability,
    label: pawns >= 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1),
  }
}

export async function analyzePosition(fen: string): Promise<Evaluation> {
  const settings = settingsForBestMove()

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [engineScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stdout = createInterface({ input: child.stdout })
    const stderr = createInterface({ input: child.stderr })

    let readyForOptions = false
    let readyForSearch = false
    let bestScoreCp: number | null = null
    let bestMate: number | null = null

    const cleanup = () => {
      stdout.close()
      stderr.close()
      child.kill()
    }

    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }

    stdout.on('line', (line) => {
      if (line === 'uciok') {
        readyForOptions = true
        child.stdin.write(`setoption name MultiPV value 1\n`)
        child.stdin.write(`setoption name Skill Level value ${settings.skillLevel}\n`)
        child.stdin.write(`setoption name UCI_LimitStrength value false\n`)
        child.stdin.write('isready\n')
        return
      }

      if (line === 'readyok' && readyForOptions) {
        readyForSearch = true
        child.stdin.write(`position fen ${fen}\n`)
        child.stdin.write(`go movetime 350\n`)
        return
      }

      if (readyForSearch && line.startsWith('info ')) {
        const cp = / score cp (-?\d+)/.exec(line)
        const mate = / score mate (-?\d+)/.exec(line)
        const multipv = / multipv (\d+)/.exec(line)

        if (!multipv || multipv[1] !== '1') {
          return
        }

        if (cp) {
          bestScoreCp = Number(cp[1])
          bestMate = null
        } else if (mate) {
          bestMate = Number(mate[1])
          bestScoreCp = null
        }
        return
      }

      if (readyForSearch && line.startsWith('bestmove ')) {
        const evaluation = formatEvaluation(bestScoreCp, bestMate)
        cleanup()
        resolve(evaluation)
      }
    })

    stderr.on('line', (line) => {
      if (line.trim()) {
        fail(new Error(`Stockfish error: ${line}`))
      }
    })

    child.on('error', (error) => {
      fail(error)
    })

    child.stdin.write('uci\n')
  })
}

export async function chooseEngineMove(
  fen: string,
  options: {
    mode: EngineMode
    targetAiRating: number
  },
): Promise<{ move: string; engineLabel: string }> {
  const settings =
    options.mode === 'act_as_ai'
      ? settingsForBestMove()
      : settingsForRating(options.targetAiRating)

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [engineScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stdout = createInterface({ input: child.stdout })
    const stderr = createInterface({ input: child.stderr })

    let readyForOptions = false
    let readyForSearch = false
    let bestMove = ''
    const candidates = new Map<number, CandidateMove>()

    const cleanup = () => {
      stdout.close()
      stderr.close()
      child.kill()
    }

    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }

    const issueSearch = () => {
      child.stdin.write(`position fen ${fen}\n`)
      child.stdin.write(`go movetime ${settings.movetime}\n`)
    }

    stdout.on('line', (line) => {
      if (line === 'uciok') {
        readyForOptions = true
        child.stdin.write(`setoption name MultiPV value ${settings.multiPv}\n`)
        child.stdin.write(`setoption name Skill Level value ${settings.skillLevel}\n`)
        child.stdin.write(
          `setoption name UCI_LimitStrength value ${settings.useLimitedStrength}\n`,
        )
        if (settings.elo) {
          child.stdin.write(`setoption name UCI_Elo value ${settings.elo}\n`)
        }
        if (settings.depth) {
          child.stdin.write(`setoption name Threads value 1\n`)
        }
        child.stdin.write('isready\n')
        return
      }

      if (line === 'readyok' && readyForOptions) {
        readyForSearch = true
        issueSearch()
        return
      }

      if (readyForSearch && line.startsWith('info ')) {
        const candidate = parseCandidate(line)
        if (candidate) {
          candidates.set(candidate.rank, {
            move: candidate.move,
            score: candidate.score,
          })
        }
        return
      }

      if (readyForSearch && line.startsWith('bestmove ')) {
        bestMove = line.split(' ')[1] ?? ''
        if (!bestMove || bestMove === '(none)') {
          fail(new Error('Engine failed to return a move.'))
          return
        }

        const chosenMove =
          settings.temperature === 0
            ? bestMove
            : pickMove([...candidates.values()], bestMove, settings.temperature)

        cleanup()
        resolve({
          move: chosenMove,
          engineLabel: settings.label,
        })
      }
    })

    stderr.on('line', (line) => {
      if (line.trim()) {
        fail(new Error(`Stockfish error: ${line}`))
      }
    })

    child.on('error', (error) => {
      fail(error)
    })

    child.stdin.write('uci\n')
  })
}
