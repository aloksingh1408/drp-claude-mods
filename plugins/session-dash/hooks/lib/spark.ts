import type { Sample } from '../../types'

const BARS = '▁▂▃▄▅▆▇█'
export const DEFAULT_COLOR = 0x01000000

export const sparkGlyph = (v: number): string =>
  BARS[Math.min(7, Math.max(0, Math.floor((v / 100) * 8)))]!

// Bucket samples over [from, to] into `width` cells, each the bucket's
// highest value, carrying the last value forward through empty buckets.
// Cells before the first sample are undefined (drawn blank).
export const resample = (
  samples: readonly Sample[],
  width: number,
  from: number,
  to: number,
): (number | undefined)[] => {
  const out: (number | undefined)[] = new Array(width).fill(undefined)
  if (width <= 0 || to <= from) return out
  const span = (to - from) / width
  for (const s of samples) {
    if (s.t < from || s.t > to) continue
    const i = Math.min(width - 1, Math.floor((s.t - from) / span))
    out[i] = Math.max(out[i] ?? 0, s.pct)
  }
  let last: number | undefined
  const before = samples.filter(s => s.t < from).at(-1)
  if (before) last = before.pct
  for (let i = 0; i < width; i++) {
    if (out[i] === undefined) out[i] = last
    else last = out[i]
  }
  return out
}

export type Cell = { ch: string; fg: number; bg?: number }

// Raster cells: base64 of little-endian u32 triplets [codePoint, fg, bg].
export const rasterCells = (cells: readonly Cell[]): string => {
  const words = new Uint32Array(cells.length * 3)
  cells.forEach((c, i) => {
    words[i * 3] = c.ch.codePointAt(0) ?? 0x20
    words[i * 3 + 1] = c.fg
    words[i * 3 + 2] = c.bg ?? DEFAULT_COLOR
  })
  const bytes = new Uint8Array(words.buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}
