import type { Elements, RenderNode } from 'claude-code'

import { truncEnd } from '../lib/format'
import type { Run } from '../lib/meter'
import { C } from '../lib/palette'

export type E = Elements['terminal']

// Fixed-width cells, so columns line up row after row.
export const cell = (s: string, w: number, align: 'left' | 'right' = 'left') => {
  const t = truncEnd(s, w)
  return align === 'right' ? t.padStart(w) : t.padEnd(w)
}

// Label on the left, value on the right, one row, never wrapping.
export const Row = (p: { E: E; w: number; left: RenderNode[]; right?: RenderNode[] }) => {
  const { Box, Text } = p.E
  return (
    <Box flexDirection="row" justifyContent="space-between" width={p.w}>
      <Text wrap="truncate">{p.left}</Text>
      {p.right ? <Text wrap="truncate">{p.right}</Text> : null}
    </Box>
  )
}

export const Bar = (p: { E: E; runs: Run[] }) => {
  const { Text } = p.E
  return (
    <Text wrap="truncate">
      {p.runs.map(r => (
        <Text color={r.color}>{r.text}</Text>
      ))}
    </Text>
  )
}

export const Rule = (p: { E: E; w: number }) => {
  const { Text } = p.E
  return <Text color={C.track}>{'─'.repeat(Math.max(0, p.w))}</Text>
}

// A section: its header is a rule, ◈ Title ────── summary, which both
// separates it from the one above and folds it (hotkey 1..7 while the pane
// holds focus, a click anytime). The body sits indented under it.
export const Section = (p: {
  E: E
  w: number
  id: string
  hotkey: string
  icon: string
  title: string
  color: string
  isOpen: boolean
  summary?: { text: string; color: string }
  onToggle: () => void
  children: RenderNode
}) => {
  const { Box, Button, Text } = p.E
  // "1: " (the engine's hotkey prefix) + "◈ Title" + " ──── " + summary + " ▸"
  const used = 3 + p.icon.length + 1 + p.title.length + 2 + (p.summary?.text.length ?? 0) + (p.isOpen ? 0 : 2)
  return (
    <Box flexDirection="column" width={p.w} marginTop={1}>
      <Box flexDirection="row" width={p.w}>
        <Button key={`fold-${p.id}`} plain hotkey={p.hotkey} onPress={p.onToggle}>
          <Text color={p.color}>{`${p.icon} `}</Text>
          <Text bold color={p.color}>{p.title}</Text>
        </Button>
        <Text wrap="truncate">
          <Text color={C.track}>{` ${'─'.repeat(Math.max(2, p.w - used))} `}</Text>
          {p.summary ? <Text color={p.summary.color}>{p.summary.text}</Text> : ''}
          <Text color={C.track}>{p.isOpen ? '' : ' ▸'}</Text>
        </Text>
      </Box>
      {p.isOpen ? (
        <Box flexDirection="column" width={p.w} paddingLeft={1} marginTop={0}>
          {p.children}
        </Box>
      ) : null}
    </Box>
  )
}

// A row with a card that shows while the pointer is over it. Cards open
// below their row, or above it (`isUp`) for rows low in the pane.
export const Hover = (p: {
  E: E
  id: string
  w: number
  isUp?: boolean
  lines: RenderNode[][]
  children: RenderNode
}) => {
  const { Box, Text } = p.E
  const width = Math.max(20, Math.min(p.w - 2, 44))
  return (
    <Box key={`hover-${p.id}`} flexDirection="column" width={p.w}>
      {p.children}
      <Box
        position="absolute"
        top={p.isUp ? -(p.lines.length + 2) : 1}
        left={2}
        width={width}
        display="none"
        hover={{ display: 'flex' }}
        flexDirection="column"
        borderStyle="round"
        borderColor={C.ident}
        backgroundColor={C.card}
        paddingX={1}
      >
        {p.lines.map(l => (
          <Text wrap="truncate">{l}</Text>
        ))}
      </Box>
    </Box>
  )
}
