import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'session-dash',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'session-dash',
  viewport: { columns: 160, rows: 50, isFullscreen: true },
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 48 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'session-dash',
  surface: 'terminal',
  component: 'AbovePrompt',
  viewport: { columns: 100, rows: 40, isFullscreen: false },
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 98 } as never,
} as const

const now = Date.parse('2026-10-09T12:00:00Z')

const USAGE = {
  startedAt: now - 2 * 3_600_000,
  context: { tokens: 380_000, window: 1_000_000, percent: 38 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 80, resetsAt: new Date(now + 72 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 59, resetsAt: new Date(now + 98 * 3_600_000).toISOString() },
  ],
  cost: { usd: 4.12 },
}

// The engine beneath the plugin: just enough answers for a session to start.
const engine = (on: On) => {
  mock.clock(on, { now } as never)
  mock.store(on)
  mock.env(on, { HOME: '/nonexistent-home' })
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: {} }) as never)
  on('session.measure', ($, e) => ({ changed: e.changed }) as never)
  on('session.usage', () => ({ value: USAGE }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.notify', () => ({ value: { isSent: false, reason: 'disabled' } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['(engine)'] }) as never)
  on('agent.spawn', ($, e) => ({ model: 'haiku', agentId: `ag-${e.description}` }))
}

const start = async ($: Engine) => {
  await $.session.start({ cwd: '/tmp/demo', surface: 'terminal', isInteractive: true })
  await $.session.measure({ ...USAGE, changed: ['context'] } as never)
}

const spawn = ($: Engine, description: string) =>
  $.agent.spawn({
    tool_use_id: `tu-${description}`,
    prompt: 'p',
    description,
    subagentType: 'Explore',
  } as never)

describe('sidebar', () => {
  test('draws every section and folds one', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'find the auth code')
    const ui = await $.ui.mount(PANE)
    for (const t of ['Limits', 'Context', 'Models', 'Activity', 'Agents', 'Sessions']) {
      expect(await ui.find({ type: 'Text', text: t })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /\$4\.12/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /find the auth/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /No other Claude sessions/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /resets/ })).toBeDefined()

    await ui.press({ key: 'fold-agents' })
    expect(await ui.find({ type: 'Text', text: /find the auth/ })).toBeUndefined()
    await ui.press({ key: 'fold-agents' })
    expect(await ui.find({ type: 'Text', text: /find the auth/ })).toBeDefined()
    await ui.unmount()
  })

  test('narrow pane with no data still draws', async ($, on) => {
    engine(on)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 30 } })
    expect(await ui.find({ type: 'Text', text: 'Limits' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Limits show after/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('live strip', () => {
  test('quiet with no agents, shown while one runs', async ($, on) => {
    engine(on)
    await start($)
    let ui = await $.ui.mount(BAND)
    expect(await ui.find({ type: 'Text', text: /agent/ })).toBeUndefined()
    await ui.unmount()

    await spawn($, 'write tests')
    ui = await $.ui.mount(BAND)
    expect(await ui.find({ type: 'Text', text: /1 agent/ })).toBeDefined()
    expect(await ui.find({ key: 'open-dash' })).toBeDefined()
    await ui.unmount()
  })
})
