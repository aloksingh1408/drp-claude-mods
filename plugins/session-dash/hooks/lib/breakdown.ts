import type { Group, GroupKey } from '../../types'

export const ORDER: GroupKey[] = ['messages', 'tools', 'system', 'memory', 'skills', 'other']

// Category names are free text, so match loosely and fall through to other.
export const groupOf = (name: string): GroupKey => {
  const n = name.toLowerCase()
  if (n.includes('message')) return 'messages'
  if (n.includes('tool') || n.includes('mcp')) return 'tools'
  if (n.includes('system')) return 'system'
  if (n.includes('memory') || n.includes('claude.md')) return 'memory'
  if (n.includes('skill')) return 'skills'
  return 'other'
}

export const groups = (
  categories: readonly { name: string; tokens: number; kind: string }[],
): Group[] => {
  const sums = new Map<GroupKey, number>()
  for (const c of categories) {
    if (c.kind !== 'used' || !(c.tokens > 0)) continue
    const k = groupOf(c.name)
    sums.set(k, (sums.get(k) ?? 0) + c.tokens)
  }
  return ORDER.filter(k => sums.has(k)).map(k => ({ key: k, tokens: sums.get(k)! }))
}

// Splits the bar's filled cells across the groups by largest remainder, so
// the segments always add up to exactly the fill the window percent gives.
export const segments = (
  gs: readonly Group[],
  pct: number | undefined,
  width: number,
): { key: GroupKey; cells: number }[] => {
  if (pct === undefined || width <= 0) return []
  const fill = Math.min(width, Math.max(0, Math.round((pct / 100) * width)))
  const total = gs.reduce((s, g) => s + g.tokens, 0)
  if (fill === 0) return []
  if (total <= 0) return [{ key: 'other', cells: fill }]
  const raw = gs.map(g => ({ key: g.key, exact: (g.tokens / total) * fill }))
  const out = raw.map(r => ({ key: r.key, cells: Math.floor(r.exact) }))
  let left = fill - out.reduce((s, o) => s + o.cells, 0)
  const byRem = raw
    .map((r, i) => ({ i, rem: r.exact - Math.floor(r.exact) }))
    .sort((a, b) => b.rem - a.rem)
  for (const { i } of byRem) {
    if (left <= 0) break
    out[i]!.cells++
    left--
  }
  return out.filter(o => o.cells > 0)
}
