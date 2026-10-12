import { C, heat } from './palette'

export type Run = { text: string; color: string }

// Pill gauge: n pills, each lit ▰ in the heat colour of its position or
// unlit ▱; the pill at even pace is ◆ once usage has reached it, else ◇.
export const pills = (frac: number, n: number, tick?: number): Run[] => {
  const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0))
  const lit = Math.min(n, Math.round(f * n))
  const at = tick !== undefined && Number.isFinite(tick) ? Math.min(n - 1, Math.max(0, Math.floor(tick * n))) : -1
  const cells: Run[] = []
  for (let i = 0; i < n; i++) {
    if (i === at) cells.push({ text: i < lit ? '◆' : '◇', color: C.pace })
    else if (i < lit) cells.push({ text: '▰', color: heat((i + 0.5) / n) })
    else cells.push({ text: '▱', color: C.track })
  }
  return merge(cells)
}

// Pills split across coloured groups (context by category, say): `parts`
// are pill counts per colour, the rest unlit.
export const groupPills = (parts: { color: string; count: number }[], n: number): Run[] => {
  const cells: Run[] = []
  for (const p of parts) for (let i = 0; i < p.count && cells.length < n; i++) cells.push({ text: '▰', color: p.color })
  while (cells.length < n) cells.push({ text: '▱', color: C.track })
  return merge(cells)
}

export const merge = (cells: Run[]): Run[] =>
  cells.reduce<Run[]>((out, c) => {
    const last = out[out.length - 1]
    if (last && last.color === c.color) last.text += c.text
    else out.push({ ...c })
    return out
  }, [])

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// ●●●○○ for high: how far up the five effort levels this one sits
export const effortDots = (effort: string): { on: string; off: string } => {
  const n = EFFORTS.indexOf(effort as (typeof EFFORTS)[number]) + 1
  return { on: '●'.repeat(Math.max(0, n)), off: '○'.repeat(5 - Math.max(0, n)) }
}
