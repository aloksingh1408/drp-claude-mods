import type { AgentStatus } from '../../types'
import { C, hexToInt } from './palette'
import type { Cell } from './spark'
import { DEFAULT_COLOR } from './spark'

// A desk is a 12×8 pixel sprite drawn as 12×4 terminal cells: each cell
// holds two pixels stacked, the top one as ▀'s foreground and the bottom
// one as its background.
export const DESK_W = 12
export const DESK_H = 8

const SKIN = '#F2C9A0'
const HAIRS = ['#3B2A20', '#E8C26A', '#8A4B2A', '#C8CEDF', '#1F1B2E']
const WOOD = '#9C7650'
const LEG = '#6B5038'
const FRAME = '#5A6284'
const SCREEN_OFF = '#2A2F42'

// h hair · f face · b shirt · a arm · M monitor frame · S screen · s screen
// line · T stand · D desk · L leg. Two frames: the arm on the keys, then up.
const ART = [
  [
    '............',
    '..hhh..MMMMM',
    '..hff..MSSSM',
    '..fff..MsSSM',
    '.bbbbb.MMMMM',
    '.bbbbbaa.T..',
    'DDDDDDDDDDDD',
    '.L........L.',
  ],
  [
    '............',
    '..hhh..MMMMM',
    '..hff..MSsSM',
    '..fff..MSSSM',
    '.bbbbbaMMMMM',
    '.bbbbb...T..',
    'DDDDDDDDDDDD',
    '.L........L.',
  ],
]

const AGENT_COLORS = [C.live, C.skills, C.ok, C.watch, C.ident, C.context]

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)

// The colour an agent wears (shirt, screen, label): stable per agent type.
export const agentColor = (type: string): string => AGENT_COLORS[hash(type) % AGENT_COLORS.length]!

const screenColor = (status: AgentStatus, color: string) =>
  status === 'running' ? color : status === 'done' ? C.ok : status === 'failed' ? C.hot : SCREEN_OFF

// The desk's pixels, row-major, a hex colour or undefined for empty.
export const deskPixels = (
  id: string,
  type: string,
  status: AgentStatus,
  frame: number,
): (string | undefined)[][] => {
  const color = agentColor(type)
  const isTyping = status === 'running'
  const art = ART[isTyping ? frame % 2 : 1]!
  const palette: Record<string, string> = {
    h: HAIRS[hash(id) % HAIRS.length]!,
    f: SKIN,
    b: color,
    a: SKIN,
    M: FRAME,
    S: screenColor(status, color),
    s: isTyping ? C.fg : screenColor(status, color),
    T: FRAME,
    D: WOOD,
    L: LEG,
  }
  return art.map(row => [...row].map(ch => palette[ch]))
}

// Folds pixel rows in pairs into ▀/▄ cells for a Raster.
export const toCells = (px: (string | undefined)[][]): Cell[] => {
  const cells: Cell[] = []
  for (let y = 0; y < px.length; y += 2) {
    const top = px[y] ?? []
    const bottom = px[y + 1] ?? []
    for (let x = 0; x < top.length; x++) {
      const t = top[x]
      const b = bottom[x]
      if (t && b) cells.push({ ch: '▀', fg: hexToInt(t), bg: hexToInt(b) })
      else if (t) cells.push({ ch: '▀', fg: hexToInt(t), bg: DEFAULT_COLOR })
      else if (b) cells.push({ ch: '▄', fg: hexToInt(b), bg: DEFAULT_COLOR })
      else cells.push({ ch: ' ', fg: DEFAULT_COLOR, bg: DEFAULT_COLOR })
    }
  }
  return cells
}
