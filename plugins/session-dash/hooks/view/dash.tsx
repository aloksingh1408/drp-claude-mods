import type { RenderNode } from 'claude-code'

import type {
  Agent,
  Agents,
  Group,
  Loadout,
  MonthCost,
  PaceWindow,
  Peer,
  Sample,
  Totals,
  Turn,
  Usage,
} from '../../types'
import * as A from '../lib/agents'
import { segments } from '../lib/breakdown'
import { dur, pct, prettyModel, stamp, tok, truncEnd, truncMid, usd, usdWhole } from '../lib/format'
import { effortDots, groupPills, pills } from '../lib/meter'
import { agentColor, deskPixels, DESK_W, toCells } from '../lib/office'
import { evenFraction, paceOf, WINDOW_MS } from '../lib/pace'
import { C, GROUP_COLOR, hexToInt, levelColor, modelColor } from '../lib/palette'
import { rasterCells, resample, sparkGlyph } from '../lib/spark'
import type { E } from './ui'
import { Bar, cell, Hover, Row, Rule, Section } from './ui'

const PILLS = 20
const LABEL_W = 10

export type DashData = {
  now: number
  tick: number
  width: number
  isBusy: boolean
  model: string
  modelId: string
  effort: string
  usage: Usage | null
  pace: Record<string, PaceWindow>
  history: Sample[]
  turn: Turn | null
  totals: Totals
  agents: Agents
  groups: Group[]
  loadout: Loadout | null
  peers: Peer[]
  folds: Record<string, boolean>
  month: MonthCost | null
  efforts: Record<string, string>
  focusAgentId?: string
}

export type DashActions = {
  toggle: (section: string) => void
  compact: () => void
}

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym

const LIMITS: Record<string, { label: string; glyph: string; color: string }> = {
  five_hour: { label: '5-hour', glyph: '◷', color: C.live },
  seven_day: { label: '7-day', glyph: '▦', color: C.skills },
  spend_limit: { label: 'Spend', glyph: '$', color: C.money },
}
const GROUP_LABEL = {
  messages: 'messages',
  tools: 'tools',
  system: 'system',
  memory: 'memory',
  skills: 'skills',
  other: 'other',
} as const

const worst = (u: Usage | null) => Math.max(0, ...(u?.limits.map(l => l.pct) ?? []))

export const spinner = (tick: number) => SPIN[tick % SPIN.length]!

const statusGlyph = (a: Agent, tick: number): [string, string] =>
  a.status === 'running'
    ? [spinner(tick), C.live]
    : a.status === 'done'
      ? ['✓', C.ok]
      : a.status === 'failed'
        ? ['✗', C.hot]
        : ['◌', C.muted]

const Dots = ({ E: El, effort, color = C.ident }: { E: E; effort: string; color?: string }) => {
  const { Text } = El
  const d = effortDots(effort)
  return (
    <Text>
      <Text color={color}>{d.on}</Text>
      <Text color={C.track}>{d.off}</Text>
      <Text color={C.muted}>{` ${cell(effort || '—', 6)}`}</Text>
    </Text>
  )
}

// A muted header row for a table: the column names, aligned to the cells.
const Head = ({ E: El, text }: { E: E; text: string }) => {
  const { Text } = El
  return <Text color={C.track}>{text}</Text>
}

// ── Header card ────────────────────────────────────────────────────────

const Top = ({ E: El, d }: { E: E; d: DashData }) => {
  const { Box, Text } = El
  const u = d.usage
  const w = worst(u)
  const chip = w >= 90 ? C.hot : w >= 80 ? C.watch : C.ident
  const elapsed = u ? d.now - u.startedAt : 0
  const perHour =
    u?.costUsd !== undefined && elapsed > 10 * 60_000 ? u.costUsd / (elapsed / 3_600_000) : undefined
  const half = Math.floor(d.width / 2)
  const pair = (label: string, value: RenderNode, valueLen: number) => (
    <Text>
      <Text color={C.muted}>{cell(label, 9)}</Text>
      {value}
      {' '.repeat(Math.max(1, half - 9 - valueLen))}
    </Text>
  )
  const monthTxt = d.month ? `${usdWhole(d.month.usd)} ${monthName(d.month.month)}` : '—'
  const rateTxt = perHour !== undefined ? `${usd(perHour)}/h` : '—'
  const tokTxt = `↑${tok(d.totals.inTok)} ↓${tok(d.totals.outTok)}`
  return (
    <Box flexDirection="column" width={d.width}>
      <Row
        E={El}
        w={d.width}
        left={[
          <Text bold color={C.ink} backgroundColor={chip}>{` ✦ ${d.model || 'Claude'} `}</Text>,
          '  ',
          <Dots E={El} effort={d.effort} />,
        ]}
        right={[
          d.isBusy ? <Text color={C.live}>{`${spinner(d.tick)} working`}</Text> : <Text color={C.muted}>idle</Text>,
        ]}
      />
      <Rule E={El} w={d.width} />
      <Text wrap="truncate">
        {pair('session', <Text bold color={C.money}>{usd(u?.costUsd)}</Text>, usd(u?.costUsd).length)}
        <Text color={C.muted}>{cell('month', 8)}</Text>
        <Text color={C.money}>{monthTxt}</Text>
      </Text>
      <Text wrap="truncate">
        {pair('time', <Text>{dur(elapsed)}</Text>, dur(elapsed).length)}
        <Text color={C.muted}>{cell('rate', 8)}</Text>
        <Text>{rateTxt}</Text>
      </Text>
      <Text wrap="truncate">
        {pair('turns', <Text>{String(d.totals.turns)}</Text>, String(d.totals.turns).length)}
        <Text color={C.muted}>{cell('tokens', 8)}</Text>
        <Text>{tokTxt}</Text>
      </Text>
    </Box>
  )
}

// ── Agent focus (when a subagent's transcript is on screen) ────────────

const Focus = ({ E: El, d, agent }: { E: E; d: DashData; agent: Agent }) => {
  const { Box, Text } = El
  const [g, gc] = statusGlyph(agent, d.tick)
  const ran = (agent.endedAt ?? d.now) - agent.startedAt
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={C.live} paddingX={1} marginTop={1} width={d.width}>
      <Text wrap="truncate">
        <Text color={gc}>{`${g} `}</Text>
        <Text bold color={agentColor(agent.type)}>{agent.type}</Text>
        <Text color={C.muted}>{agent.model ? ` · ${prettyModel(agent.model)}` : ''}</Text>
      </Text>
      <Text wrap="wrap">{agent.description}</Text>
      <Text color={C.muted} wrap="truncate">
        {`${agent.status} · ${dur(ran)} · ${agent.tools} tools${agent.outTok ? ` · ${tok(agent.outTok)} out` : ''}`}
      </Text>
      {agent.lastTools.length ? (
        <Text color={C.muted} wrap="truncate">{`recent  ${agent.lastTools.join(' → ')}`}</Text>
      ) : null}
    </Box>
  )
}

// ── Office: everyone at their desk ─────────────────────────────────────

const DESK_COL = DESK_W + 3

const Desk = ({ E: El, d, a }: { E: E; d: DashData; a: Agent }) => {
  const { Box, Raster, Text } = El
  const color = agentColor(a.type)
  const ran = (a.endedAt ?? d.now) - a.startedAt
  const status =
    a.status === 'running'
      ? (a.lastTools.at(-1) ?? 'thinking')
      : a.status === 'done'
        ? `✓ ${dur(ran)}`
        : a.status === 'failed'
          ? '✗ failed'
          : '◌ quiet'
  const statusColor = a.status === 'running' ? C.fg : a.status === 'done' ? C.ok : a.status === 'failed' ? C.hot : C.muted
  return (
    <Box flexDirection="column" width={DESK_COL}>
      <Raster
        key={`desk-${a.id}`}
        columns={DESK_W}
        rows={4}
        cells={rasterCells(toCells(deskPixels(a.id, a.type, a.status, d.tick)))}
      />
      <Text bold color={color} wrap="truncate">{cell(a.type, DESK_COL - 2)}</Text>
      <Text color={statusColor} wrap="truncate">{cell(status, DESK_COL - 2)}</Text>
    </Box>
  )
}

const Office = ({ E: El, d }: { E: E; d: DashData }) => {
  const { Box, Text } = El
  const w = d.width - 1
  const perRow = Math.max(1, Math.floor(w / DESK_COL))
  const people = [...d.agents.list]
    .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || a.startedAt - b.startedAt)
    .slice(0, perRow * 2)
  const rows: Agent[][] = []
  for (let i = 0; i < people.length; i += perRow) rows.push(people.slice(i, i + perRow))
  const extra = d.agents.list.length - people.length
  return (
    <Box flexDirection="column" width={w}>
      {rows.map((r, i) => (
        <Box flexDirection="row" width={w} marginTop={i ? 1 : 0}>
          {r.map(a => (
            <Desk E={El} d={d} a={a} />
          ))}
        </Box>
      ))}
      {extra > 0 ? <Text color={C.muted}>{`+${extra} more in the office`}</Text> : null}
    </Box>
  )
}

// ── Limits: one gauge line each ────────────────────────────────────────

const Spark = ({ E: El, d, w }: { E: E; d: DashData; w: number }) => {
  const { Raster } = El
  const vals = resample(d.history, w, d.now - WINDOW_MS.five_hour!, d.now)
  const cells = vals.map(v =>
    v === undefined ? { ch: ' ', fg: hexToInt(C.ok) } : { ch: sparkGlyph(v), fg: hexToInt(levelColor(v)) },
  )
  return <Raster key="spark-5h" columns={w} rows={1} cells={rasterCells(cells)} />
}

const Limits = ({ E: El, d }: { E: E; d: DashData }) => {
  const { Box, Text } = El
  const limits = d.usage?.limits ?? []
  const w = d.width - 1
  const indent = ' '.repeat(LABEL_W)
  if (!limits.length) return <Text color={C.muted}>Limits show after Claude's first reply.</Text>
  return (
    <Box flexDirection="column" width={w}>
      {limits.map((l, i) => {
        const meta = LIMITS[l.kind] ?? { label: l.kind, glyph: '•', color: C.muted }
        const even = evenFraction(l.kind, d.now, l.resetsAt)
        const p = paceOf(d.pace[l.kind], d.now, l.pct, l.resetsAt)
        const card: RenderNode[][] = [
          [<Text bold color={meta.color}>{`${meta.label} window`}</Text>],
          [`${pct(l.pct)} used`, even !== undefined ? ` · even pace ${pct(even * 100)}` : ''],
          [l.resetsAt ? `resets ${stamp(l.resetsAt, d.now)} IST` : 'reset time unknown'],
          [p.state === 'unknown' ? 'pace needs 5 min of readings' : `burning ${p.ratePerH.toFixed(1)}% an hour`],
        ]
        return (
          <Box flexDirection="column" width={w} marginTop={i ? 1 : 0}>
            <Hover E={El} id={`limit-${l.kind}`} w={w} lines={card}>
              <Text wrap="truncate">
                <Text bold color={meta.color}>{cell(`${meta.glyph} ${meta.label}`, LABEL_W)}</Text>
                <Bar E={El} runs={pills(l.pct / 100, PILLS, even)} />
                <Text bold color={levelColor(l.pct)}>{pct(l.pct).padStart(6)}</Text>
              </Text>
            </Hover>
            {l.resetsAt ? (
              <Text wrap="truncate">
                <Text color={C.muted}>{`${indent}↻ `}</Text>
                <Text>{stamp(l.resetsAt, d.now)}</Text>
                <Text color={C.muted}>{` · in ${dur(l.resetsAt - d.now)}`}</Text>
              </Text>
            ) : null}
            {p.state === 'ahead' ? (
              <Text color={C.watch} wrap="truncate">{`${indent}▲ ahead of pace · full in ${dur(p.toFullMs)}`}</Text>
            ) : p.state === 'on' ? (
              <Text color={C.ok} wrap="truncate">
                {`${indent}✓ on pace${p.ratePerH > 0 ? ` · ${p.ratePerH.toFixed(1)}%/h` : ''}`}
              </Text>
            ) : null}
            {l.kind === 'five_hour' && d.history.length > 1 && w >= 36 ? (
              <Box flexDirection="row">
                <Text>{indent}</Text>
                <Spark E={El} d={d} w={PILLS} />
                <Text color={C.muted}>{' last 5h'}</Text>
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}

// ── Context ────────────────────────────────────────────────────────────

const Context = ({ E: El, d, act }: { E: E; d: DashData; act: DashActions }) => {
  const { Box, Button, Text } = El
  const u = d.usage
  const w = d.width - 1
  const ctx = u?.ctxPct ?? 0
  const segs = segments(d.groups, u?.ctxPct, PILLS)
  const parts = segs.length
    ? segs.map(s => ({ color: GROUP_COLOR[s.key], count: s.cells }))
    : [{ color: levelColor(ctx), count: Math.round((ctx / 100) * PILLS) }]
  const legend = d.groups.filter(g => g.tokens > 0)
  const rows: Group[][] = []
  for (let i = 0; i < legend.length; i += 2) rows.push(legend.slice(i, i + 2))
  const colW = Math.floor((w - LABEL_W) / 2)
  const valW = colW - 2 - 9 - 1
  return (
    <Box flexDirection="column" width={w}>
      <Text wrap="truncate">
        <Text bold color={C.context}>{cell('used', LABEL_W)}</Text>
        <Bar E={El} runs={groupPills(parts, PILLS)} />
        <Text bold color={levelColor(ctx)}>{pct(u?.ctxPct).padStart(6)}</Text>
      </Text>
      <Text wrap="truncate">
        <Text color={C.muted}>{cell('tokens', LABEL_W)}</Text>
        <Text>{tok(u?.ctxTokens)}</Text>
        <Text color={C.muted}>{` of ${tok(u?.ctxWindow)}`}</Text>
      </Text>
      {rows.map((r, i) => (
        <Text wrap="truncate">
          <Text color={C.muted}>{cell(i === 0 ? 'by kind' : '', LABEL_W)}</Text>
          {r.map(g => (
            <Text>
              <Text color={GROUP_COLOR[g.key]}>{'● '}</Text>
              <Text color={C.muted}>{cell(GROUP_LABEL[g.key], 9)}</Text>
              <Text>{cell(tok(g.tokens), valW, 'right')}</Text>
              <Text>{' '}</Text>
            </Text>
          ))}
        </Text>
      ))}
      {ctx >= 85 && !d.isBusy ? (
        <Box marginTop={1}>
          <Button key="compact" label="Compact now" variant="primary" onPress={act.compact} />
        </Box>
      ) : null}
    </Box>
  )
}

// ── Models: a table, plus one stacked share bar ────────────────────────

const Models = ({ E: El, d }: { E: E; d: DashData }) => {
  const { Box, Text } = El
  const w = d.width - 1
  const by = d.month?.byModel ?? {}
  const ids = Object.keys(by).sort((a, b) => by[b]! - by[a]!)
  if (d.modelId && !ids.includes(d.modelId)) ids.unshift(d.modelId)
  if (!ids.length) return <Text color={C.muted}>Model usage shows once the month total is ready.</Text>
  const total = Object.values(by).reduce((s, v) => s + v, 0)
  const shown = ids.slice(0, 4)
  const NAME = 13
  const EFF = 12
  const SHARE = 6
  const COST = Math.max(7, w - NAME - EFF - SHARE)
  const parts = shown.map(id => ({
    color: modelColor(id),
    count: total > 0 ? Math.max((by[id] ?? 0) > 0 ? 1 : 0, Math.round(((by[id] ?? 0) / total) * PILLS)) : 0,
  }))
  return (
    <Box flexDirection="column" width={w}>
      <Head E={El} text={`${cell('model', NAME)}${cell('effort', EFF)}${cell('share', SHARE, 'right')}${cell('cost', COST, 'right')}`} />
      {shown.map(id => {
        const usdV = by[id] ?? 0
        const share = total > 0 ? usdV / total : 0
        const isNow = id === d.modelId
        const effort = isNow && d.effort ? d.effort : (d.efforts[id] ?? d.efforts['*'] ?? '')
        const mc = modelColor(id)
        return (
          <Text wrap="truncate">
            <Text bold color={mc}>{`${cell(`${prettyModel(id)}${isNow ? ' ●' : ''}`, NAME - 1)} `}</Text>
            <Dots E={El} effort={effort} color={mc} />
            <Text color={mc}>{cell(share > 0 && share < 0.01 ? '<1%' : pct(share * 100), SHARE, 'right')}</Text>
            <Text color={C.money}>{cell(usdV >= 10 ? usdWhole(usdV) : usd(usdV), COST, 'right')}</Text>
          </Text>
        )
      })}
      <Text wrap="truncate">
        <Bar E={El} runs={groupPills(parts, PILLS)} />
        <Text color={C.muted}>{d.month ? `  ${usdWhole(d.month.usd)} in ${monthName(d.month.month)}` : ''}</Text>
      </Text>
    </Box>
  )
}

// ── Activity ───────────────────────────────────────────────────────────

const Activity = ({ E: El, d }: { E: E; d: DashData }) => {
  const { Box, Text } = El
  const t = d.turn
  return (
    <Box flexDirection="column" width={d.width - 1}>
      <Text wrap="truncate">
        <Text color={C.muted}>{cell('last turn', LABEL_W)}</Text>
        {t ? (
          <Text>
            <Text>{cell(dur(t.durationMs), 9)}</Text>
            <Text>{cell(`${t.tools} tool${t.tools === 1 ? '' : 's'}`, 10)}</Text>
            {t.costDelta !== undefined ? <Text color={C.money}>{`+${usd(t.costDelta)}`}</Text> : ''}
          </Text>
        ) : (
          <Text color={C.muted}>—</Text>
        )}
      </Text>
    </Box>
  )
}

// ── Agents: a table ────────────────────────────────────────────────────

const AgentsList = ({ E: El, d }: { E: E; d: DashData }) => {
  const { Box, Text } = El
  const w = d.width - 1
  const { rows, more } = A.rows(d.agents, 6)
  if (!rows.length) return <Text color={C.muted}>No agents running.</Text>
  const TYPE = 11
  const TIME = 7
  const TOOL = 7
  const TASK = Math.max(6, w - 2 - TYPE - TIME - TOOL)
  return (
    <Box flexDirection="column" width={w}>
      <Head E={El} text={`  ${cell('agent', TYPE)}${cell('task', TASK)}${cell('time', TIME, 'right')}${cell(' tool', TOOL)}`} />
      {rows.map(r => {
        if (r.kind === 'run') {
          const parts = [`${r.done} done`, r.running ? `${r.running} running` : '', r.failed ? `${r.failed} failed` : '']
            .filter(Boolean)
            .join(' · ')
          return (
            <Text wrap="truncate">
              <Text color={r.running ? C.live : C.ok}>{r.running ? `${spinner(d.tick)} ` : '◆ '}</Text>
              <Text bold color={C.live}>{cell(r.name, TYPE + 4)}</Text>
              <Text color={r.failed ? C.hot : C.muted}>{parts}</Text>
            </Text>
          )
        }
        const a = r.agent
        const [g, gc] = statusGlyph(a, d.tick)
        const ran = (a.endedAt ?? d.now) - a.startedAt
        const tool = a.status === 'running' ? (a.lastTools.at(-1) ?? '') : a.outTok ? tok(a.outTok) : ''
        const card: RenderNode[][] = [
          [
            <Text bold color={agentColor(a.type)}>{a.type}</Text>,
            <Text color={C.muted}>{a.model ? ` · ${prettyModel(a.model)}` : ''}</Text>,
          ],
          [truncEnd(a.description, 40)],
          [`${a.status} · ${dur(ran)} · ${a.tools} tools`],
          [a.lastTools.length ? `recent ${a.lastTools.join(' → ')}` : 'no tools yet'],
        ]
        return (
          <Hover E={El} id={`agent-${a.id}`} w={w} isUp lines={card}>
            <Text wrap="truncate">
              <Text color={gc}>{`${g} `}</Text>
              <Text color={agentColor(a.type)}>{`${cell(a.type, TYPE - 1)} `}</Text>
              <Text color={a.status === 'running' ? C.fg : C.muted}>{`${cell(truncMid(a.description, TASK - 1), TASK - 1)} `}</Text>
              <Text color={C.muted}>{cell(dur(ran), TIME, 'right')}</Text>
              <Text color={C.muted}>{cell(` ${tool}`, TOOL)}</Text>
            </Text>
          </Hover>
        )
      })}
      {more ? <Text color={C.muted}>{`+${more} more`}</Text> : null}
    </Box>
  )
}

// ── Sessions: a table ──────────────────────────────────────────────────

const Sessions = ({ E: El, d }: { E: E; d: DashData }) => {
  const { Box, Text } = El
  const w = d.width - 1
  if (!d.peers.length) return <Text color={C.muted}>No other Claude sessions running.</Text>
  const NAME = 12
  const COST = 8
  const STATUS = Math.max(8, w - 2 - NAME - COST)
  return (
    <Box flexDirection="column" width={w}>
      <Head E={El} text={`  ${cell('session', NAME)}${cell('status', STATUS)}${cell('cost', COST, 'right')}`} />
      {d.peers.slice(0, 6).map(p => {
        const status = p.isBusy
          ? `working${p.agentsRunning ? ` · ${p.agentsRunning} agent${p.agentsRunning === 1 ? '' : 's'}` : ''}`
          : 'idle'
        const card: RenderNode[][] = [
          [<Text bold>{p.label}</Text>],
          [p.cwd],
          [`${p.model || 'Claude'} · ${usd(p.costUsd)}`],
          [`last seen ${d.now - p.updatedAt < 60_000 ? 'just now' : `${dur(d.now - p.updatedAt)} ago`}`],
        ]
        return (
          <Hover E={El} id={`peer-${p.sessionId}`} w={w} isUp lines={card}>
            <Text wrap="truncate">
              <Text color={p.isBusy ? C.live : C.track}>{p.isBusy ? '● ' : '○ '}</Text>
              <Text bold>{`${cell(p.label, NAME - 1)} `}</Text>
              <Text color={p.isBusy ? C.fg : C.muted}>{cell(status, STATUS)}</Text>
              <Text color={C.money}>{cell(usd(p.costUsd), COST, 'right')}</Text>
            </Text>
          </Hover>
        )
      })}
    </Box>
  )
}

// ── Loadout ────────────────────────────────────────────────────────────

const LoadoutLine = ({ E: El, d }: { E: E; d: DashData }) => {
  const { Box, Text } = El
  const l = d.loadout
  if (!l) return null
  const item = (glyph: string, color: string, n: number, label: string) => (
    <Text>
      <Text color={color}>{`${glyph} `}</Text>
      <Text bold>{String(n)}</Text>
      <Text color={C.muted}>{` ${label}  `}</Text>
    </Text>
  )
  return (
    <Box flexDirection="column" marginTop={1} width={d.width}>
      <Rule E={El} w={d.width} />
      <Text wrap="truncate">
        {item('✦', C.skills, l.skills, 'skills')}
        {item('⊞', C.ident, l.plugins, 'plugins')}
        {item('⚙', C.money, l.mcp, 'MCP')}
        {item('◇', C.live, l.agents, 'agents')}
      </Text>
    </Box>
  )
}

// ── The pane ───────────────────────────────────────────────────────────

export const Dash = ({ E: El, d, act }: { E: E; d: DashData; act: DashActions }) => {
  const { Box } = El
  const w = d.width
  const isOpen = (k: string) => !d.folds[k]
  const c = A.counts(d.agents)
  const u = d.usage
  const focus = d.focusAgentId ? d.agents.list.find(a => a.id === d.focusAgentId) : undefined
  const fold = (id: string) => ({ id, isOpen: isOpen(id), onToggle: () => act.toggle(id) })
  const limitSummary = (u?.limits ?? []).map(l => `${LIMITS[l.kind]?.label ?? l.kind} ${pct(l.pct)}`).join(' · ')

  return (
    <Box flexDirection="column" width={w}>
      <Top E={El} d={d} />
      {focus ? <Focus E={El} d={d} agent={focus} /> : null}
      {d.agents.list.length ? (
        <Section
          E={El}
          w={w}
          {...fold('office')}
          hotkey="7"
          icon="⌂"
          title="Office"
          color={C.context}
          summary={{ text: c.running ? `${c.running} at work` : 'all done', color: c.running ? C.live : C.ok }}
        >
          <Office E={El} d={d} />
        </Section>
      ) : null}
      <Section E={El} w={w} {...fold('limits')} hotkey="1" icon="◈" title="Limits" color={C.live}
        summary={{ text: limitSummary, color: C.muted }}>
        <Limits E={El} d={d} />
      </Section>
      <Section E={El} w={w} {...fold('context')} hotkey="2" icon="◔" title="Context" color={C.context}
        summary={{ text: pct(u?.ctxPct), color: levelColor(u?.ctxPct ?? 0) }}>
        <Context E={El} d={d} act={act} />
      </Section>
      <Section E={El} w={w} {...fold('models')} hotkey="3" icon="✦" title="Models" color={C.ident}
        summary={{ text: d.month ? `${monthName(d.month.month)} so far` : '', color: C.muted }}>
        <Models E={El} d={d} />
      </Section>
      <Section E={El} w={w} {...fold('activity')} hotkey="4" icon="↯" title="Activity" color={C.watch}
        summary={{ text: d.turn ? `last ${dur(d.turn.durationMs)}` : '', color: C.muted }}>
        <Activity E={El} d={d} />
      </Section>
      <Section E={El} w={w} {...fold('agents')} hotkey="5" icon="◎" title="Agents" color={C.live}
        summary={{ text: c.running ? `${c.running} running` : 'none', color: c.running ? C.live : C.muted }}>
        <AgentsList E={El} d={d} />
      </Section>
      <Section E={El} w={w} {...fold('sessions')} hotkey="6" icon="▣" title="Sessions" color={C.skills}
        summary={{ text: d.peers.length ? `${d.peers.length} other` : 'only this one', color: C.muted }}>
        <Sessions E={El} d={d} />
      </Section>
      <LoadoutLine E={El} d={d} />
    </Box>
  )
}

// ── The live strip above the prompt ────────────────────────────────────

export const Strip = ({
  E: El,
  d,
  isDocked,
  onOpen,
}: {
  E: E
  d: DashData
  isDocked: boolean
  onOpen: () => void
}) => {
  const { Box, Button, Text } = El
  const { rows } = A.rows(d.agents, 20)
  const agents = rows.filter((r): r is A.AgentRow => r.kind === 'agent' && r.agent.status === 'running')
  const runs = rows.filter((r): r is A.RunRow => r.kind === 'run' && r.running > 0)
  const c = A.counts(d.agents)
  const parts: RenderNode[] = [
    <Text color={C.live}>{`${spinner(d.tick)} `}</Text>,
    <Text bold>{`${c.running} agent${c.running === 1 ? '' : 's'}`}</Text>,
  ]
  if (!isDocked) {
    for (const r of agents.slice(0, 2)) {
      parts.push(<Text color={C.track}>{'  ·  '}</Text>)
      parts.push(<Text color={agentColor(r.agent.type)}>{r.agent.type}</Text>)
      const last = r.agent.lastTools.at(-1)
      if (last) parts.push(<Text color={C.muted}>{` ${last}`}</Text>)
    }
    if (agents.length > 2) parts.push(<Text color={C.muted}>{` +${agents.length - 2}`}</Text>)
    for (const r of runs.slice(0, 1)) {
      parts.push(<Text color={C.track}>{'    '}</Text>)
      parts.push(<Text color={C.live}>{'◆ '}</Text>)
      parts.push(<Text bold>{r.name}</Text>)
      parts.push(
        <Text color={C.muted}>{` ${r.done} done · ${r.running} running${r.failed ? ` · ${r.failed} failed` : ''}`}</Text>,
      )
    }
  }
  return (
    <Box flexDirection="row" justifyContent="space-between" width={d.width}>
      <Text wrap="truncate">{parts}</Text>
      {isDocked ? null : <Button key="open-dash" plain hotkey="d" label="dash" onPress={onOpen} />}
    </Box>
  )
}
