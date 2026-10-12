import type { Agent, Agents } from '../../types'

const MIN = 60_000
const LOST_AFTER = 30 * MIN
const KEEP_AFTER = 10 * MIN

export const EMPTY: Agents = { list: [], runNames: {} }

export type Spawn = {
  id: string
  type: string
  description: string
  model?: string
  at: number
  runId?: string
  toolUseId?: string
}

export const spawn = (s: Agents, a: Spawn): Agents => ({
  ...s,
  list: [
    ...s.list.filter(x => x.id !== a.id),
    {
      id: a.id,
      type: a.type,
      description: a.description,
      model: a.model,
      startedAt: a.at,
      lastEventAt: a.at,
      tools: 0,
      lastTools: [],
      status: 'running',
      runId: a.runId || undefined,
      toolUseId: a.toolUseId || undefined,
    },
  ],
})

const patch = (s: Agents, id: string, fn: (a: Agent) => Agent): Agents => {
  if (!s.list.some(a => a.id === id)) return s
  return { ...s, list: s.list.map(a => (a.id === id ? fn(a) : a)) }
}

export const tool = (s: Agents, id: string, name: string, at: number): Agents =>
  patch(s, id, a => ({
    ...a,
    tools: a.tools + 1,
    lastTools: [...a.lastTools, name].slice(-3),
    lastEventAt: at,
    status: a.status === 'lost' ? 'running' : a.status,
  }))

export const complete = (
  s: Agents,
  id: string,
  reason: string,
  at: number,
  outTok?: number,
): Agents =>
  patch(s, id, a => ({
    ...a,
    status: reason === 'answer' ? 'done' : 'failed',
    endedAt: at,
    lastEventAt: at,
    outTok,
  }))

export const nameRun = (s: Agents, toolUseId: string, name: string): Agents => ({
  ...s,
  runNames: { ...s.runNames, [toolUseId]: name },
})

const isOpen = (a: Agent) => a.status === 'running'

// Marks silent agents lost and drops what finished more than 10 min ago.
// A workflow's agents stay until the whole run has been quiet that long.
export const sweep = (s: Agents, now: number): Agents => {
  const marked = s.list.map(a =>
    isOpen(a) && now - a.lastEventAt > LOST_AFTER ? { ...a, status: 'lost' as const, endedAt: now } : a,
  )
  const runLast = new Map<string, number>()
  const runOpen = new Set<string>()
  for (const a of marked) {
    if (!a.runId) continue
    runLast.set(a.runId, Math.max(runLast.get(a.runId) ?? 0, a.endedAt ?? a.lastEventAt))
    if (isOpen(a)) runOpen.add(a.runId)
  }
  const list = marked.filter(a => {
    if (isOpen(a)) return true
    if (a.runId) return runOpen.has(a.runId) || now - (runLast.get(a.runId) ?? 0) <= KEEP_AFTER
    return now - (a.endedAt ?? a.lastEventAt) <= KEEP_AFTER
  })
  const isSame = list.length === s.list.length && list.every((a, i) => a === s.list[i])
  return isSame ? s : { ...s, list }
}

export type RunRow = {
  kind: 'run'
  runId: string
  name: string
  startedAt: number
  done: number
  running: number
  failed: number
  lastTool?: string
}
export type AgentRow = { kind: 'agent'; agent: Agent }
export type Row = AgentRow | RunRow

const isRowRunning = (r: Row) => (r.kind === 'agent' ? isOpen(r.agent) : r.running > 0)
const rowStart = (r: Row) => (r.kind === 'agent' ? r.agent.startedAt : r.startedAt)

export const rows = (s: Agents, cap = 6): { rows: Row[]; more: number } => {
  const out: Row[] = []
  const runs = new Map<string, RunRow>()
  for (const a of s.list) {
    if (!a.runId) {
      out.push({ kind: 'agent', agent: a })
      continue
    }
    let r = runs.get(a.runId)
    if (!r) {
      r = {
        kind: 'run',
        runId: a.runId,
        name: (a.toolUseId && s.runNames[a.toolUseId]) || 'workflow',
        startedAt: a.startedAt,
        done: 0,
        running: 0,
        failed: 0,
      }
      runs.set(a.runId, r)
      out.push(r)
    }
    r.startedAt = Math.min(r.startedAt, a.startedAt)
    if (isOpen(a)) {
      r.running++
      r.lastTool = a.lastTools.at(-1) ?? r.lastTool
    } else if (a.status === 'done') r.done++
    else r.failed++
  }
  out.sort((a, b) =>
    isRowRunning(a) !== isRowRunning(b) ? (isRowRunning(a) ? -1 : 1) : rowStart(b) - rowStart(a),
  )
  return { rows: out.slice(0, cap), more: Math.max(0, out.length - cap) }
}

export const counts = (s: Agents) => {
  const { rows: all } = rows(s, Number.MAX_SAFE_INTEGER)
  const agents = all.filter(r => r.kind === 'agent' && isOpen(r.agent)).length
  const runs = all.filter(r => r.kind === 'run' && r.running > 0).length
  const running = s.list.filter(isOpen).length
  return { agents, runs, running }
}

// A Workflow call's name: its `name` input, else the script's meta name.
export const workflowName = (input: Record<string, unknown>): string => {
  if (typeof input.name === 'string' && input.name) return input.name
  const script = typeof input.script === 'string' ? input.script : ''
  const m = /meta\s*=\s*\{[^}]*?name\s*:\s*['"`]([^'"`]+)['"`]/.exec(script)
  return m?.[1] ?? 'workflow'
}
