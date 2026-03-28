import type { MoveEntry, OpeningStatus, PlayerColor } from './types.js'

export type OpeningDefinition = {
  id: string
  name: string
  side: PlayerColor
  style: string
  lines: string[][]
}

const openings: OpeningDefinition[] = [
  {
    id: 'ruy-lopez',
    name: 'Ruy Lopez',
    side: 'white',
    style: 'strategic',
    lines: [['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']],
  },
  {
    id: 'italian-game',
    name: 'Italian Game',
    side: 'white',
    style: 'active',
    lines: [['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4']],
  },
  {
    id: 'queens-gambit',
    name: "Queen's Gambit",
    side: 'white',
    style: 'solid / positional',
    lines: [['d2d4', 'd7d5', 'c2c4']],
  },
  {
    id: 'london-system',
    name: 'London System',
    side: 'white',
    style: 'versatile setup',
    lines: [['d2d4', 'd7d5', 'c1f4']],
  },
  {
    id: 'vienna-game',
    name: 'Vienna Game',
    side: 'white',
    style: 'aggressive',
    lines: [['e2e4', 'e7e5', 'b1c3']],
  },
  {
    id: 'scholars-mate',
    name: "Scholar's Mate",
    side: 'white',
    style: 'tactical / trap',
    lines: [['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7']],
  },
  {
    id: 'caro-kann-defense',
    name: 'Caro-Kann Defense',
    side: 'black',
    style: 'solid',
    lines: [['e2e4', 'c7c6']],
  },
  {
    id: 'french-defense',
    name: 'French Defense',
    side: 'black',
    style: 'counterattacking',
    lines: [['e2e4', 'e7e6']],
  },
  {
    id: 'sicilian-defense',
    name: 'Sicilian Defense',
    side: 'black',
    style: 'aggressive',
    lines: [['e2e4', 'c7c5']],
  },
  {
    id: 'kings-indian-defense',
    name: "King's Indian Defense",
    side: 'black',
    style: 'aggressive / dynamic',
    lines: [['d2d4', 'g8f6', 'c2c4', 'g7g6']],
  },
]

function moveToUci(move: MoveEntry) {
  return `${move.from}${move.to}`
}

export function listOpenings() {
  return openings
}

export function getOpeningById(openingId: string | null | undefined) {
  if (!openingId) {
    return null
  }

  return openings.find((opening) => opening.id === openingId) ?? null
}

export function getOpeningsForSide(side: PlayerColor) {
  return openings.filter((opening) => opening.side === side)
}

export function resolveOpeningProgress(
  openingId: string | null | undefined,
  moveHistory: MoveEntry[],
): {
  openingId: string | null
  openingName: string | null
  openingSide: PlayerColor | null
  openingStatus: OpeningStatus
  nextMove: string | null
 } {
  const opening = getOpeningById(openingId)
  if (!opening) {
    return {
      openingId: null,
      openingName: null,
      openingSide: null,
      openingStatus: 'none',
      nextMove: null,
    }
  }

  const played = moveToUci
  const playedMoves = moveHistory.map(played)
  const matchingLines = opening.lines.filter((line) =>
    playedMoves.every((move, index) => line[index] === move),
  )

  if (matchingLines.length === 0) {
    return {
      openingId: opening.id,
      openingName: opening.name,
      openingSide: opening.side,
      openingStatus: 'broken',
      nextMove: null,
    }
  }

  const nextMove = matchingLines[0][playedMoves.length] ?? null
  return {
    openingId: opening.id,
    openingName: opening.name,
    openingSide: opening.side,
    openingStatus: nextMove ? 'following' : 'broken',
    nextMove,
  }
}
