import type { PaceWindow, Sample } from '../../types'

const MIN = 60_000
export const WINDOW_MS: Record<string, number> = {
  five_hour: 5 * 60 * MIN,
  seven_day: 7 * 24 * 60 * MIN,
}
const KEEP_MS = 30 * MIN
const MIN_SPAN_MS = 5 * MIN

export type Pace =
  | { state: 'unknown' }
  | { state: 'on'; ratePerH: number }
  | { state: 'ahead'; ratePerH: number; toFullMs: number }

// Adds a reading. A drop in % or a moved reset time starts a new window.
// Keeps the last 30 min plus one older anchor, so a quiet window still
// has a baseline to measure from.
export const addSample = (
  win: PaceWindow | undefined,
  s: Sample,
  resetsAt?: number,
): PaceWindow => {
  if (!win) return { samples: [s], resetsAt }
  const last = win.samples[win.samples.length - 1]
  const isMoved =
    resetsAt !== undefined &&
    win.resetsAt !== undefined &&
    Math.abs(resetsAt - win.resetsAt) > MIN
  const isDropped = last !== undefined && s.pct < last.pct - 0.5
  if (isMoved || isDropped) return { samples: [s], resetsAt }
  if (last && last.pct === s.pct) return { ...win, resetsAt: resetsAt ?? win.resetsAt }
  const all = [...win.samples, s]
  const recent = all.filter(x => s.t - x.t <= KEEP_MS)
  const anchor = all.filter(x => s.t - x.t > KEEP_MS).at(-1)
  return {
    samples: (anchor ? [anchor, ...recent] : recent).slice(-200),
    resetsAt: resetsAt ?? win.resetsAt,
  }
}

export const paceOf = (
  win: PaceWindow | undefined,
  now: number,
  pct: number,
  resetsAt?: number,
): Pace => {
  const base = win?.samples[0]
  if (!base || now - base.t < MIN_SPAN_MS || (win?.samples.length ?? 0) < 2) {
    return { state: 'unknown' }
  }
  const ratePerMs = (pct - base.pct) / (now - base.t)
  const ratePerH = ratePerMs * 60 * MIN
  if (ratePerMs <= 0) return { state: 'on', ratePerH: 0 }
  const toFullMs = (100 - pct) / ratePerMs
  if (resetsAt !== undefined && now + toFullMs < resetsAt) {
    return { state: 'ahead', ratePerH, toFullMs }
  }
  return { state: 'on', ratePerH }
}

// Where usage would sit if spent evenly across the window: 0..1.
export const evenFraction = (
  kind: string,
  now: number,
  resetsAt?: number,
): number | undefined => {
  const len = WINDOW_MS[kind]
  if (!len || resetsAt === undefined) return undefined
  return Math.min(1, Math.max(0, 1 - (resetsAt - now) / len))
}
