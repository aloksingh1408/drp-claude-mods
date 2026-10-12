import type { Peer } from '../../types'

export const STALE_MS = 10 * 60_000
export const REAP_MS = 60 * 60_000

export const labelFor = (envLabel: string | undefined, cwd: string): string => {
  const set = envLabel?.trim()
  if (set) return set
  const base = cwd.replace(/\/+$/, '').split('/').pop()
  return base ? base.toUpperCase() : 'SESSION'
}

export const tildify = (path: string, home: string | undefined): string =>
  home && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path

export type Heartbeat = Omit<Peer, 'updatedAt'> & { v: 1; updatedAt: string }

export const heartbeat = (p: Peer): string =>
  JSON.stringify({ v: 1, ...p, updatedAt: new Date(p.updatedAt).toISOString() })

// A peer from a heartbeat file, or undefined for a corrupt, foreign,
// stale or own file.
export const parsePeer = (text: string, selfId: string, now: number): Peer | undefined => {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object') return undefined
  const h = j as Partial<Heartbeat>
  if (h.v !== 1 || typeof h.sessionId !== 'string' || h.sessionId === selfId) return undefined
  const updatedAt = typeof h.updatedAt === 'string' ? Date.parse(h.updatedAt) : NaN
  if (!Number.isFinite(updatedAt) || now - updatedAt > STALE_MS) return undefined
  return {
    sessionId: h.sessionId,
    label: String(h.label ?? 'SESSION'),
    cwd: String(h.cwd ?? ''),
    model: String(h.model ?? ''),
    isBusy: h.isBusy === true,
    agentsRunning: Number(h.agentsRunning) || 0,
    costUsd: typeof h.costUsd === 'number' ? h.costUsd : undefined,
    updatedAt,
  }
}
