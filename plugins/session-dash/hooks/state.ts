// The module's own variables: they start over on a reload, which only
// costs the current turn's tool count.
export const live = {
  cwd: '',
  home: '',
  label: '',
  turnTools: 0,
  // set by the prompt band's render (which must not change state); the
  // poll opens the sidebar once it has seen a fullscreen terminal
  sawFullscreen: false,
  turnCost: undefined as number | undefined,
  plugins: 0,
}

export const swallow = (p: Promise<unknown>): void => {
  p.catch(() => {})
}
