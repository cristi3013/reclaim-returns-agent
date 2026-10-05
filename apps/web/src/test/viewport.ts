/** Stubs window.matchMedia so components see a phone or a desktop viewport. jsdom has no matchMedia. */
export function stubViewport(kind: 'phone' | 'desktop') {
  const mql = (query: string): MediaQueryList =>
    ({
      matches: kind === 'phone' && /max-width/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
  Object.defineProperty(window, 'matchMedia', { value: mql, configurable: true, writable: true })
}
