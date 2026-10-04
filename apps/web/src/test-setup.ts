import '@testing-library/jest-dom/vitest'

// Node 25 exposes an experimental localStorage global that shadows jsdom's. Use a plain in-memory one.
class MemoryStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true })
Object.defineProperty(window, 'localStorage', { value: globalThis.localStorage, configurable: true, writable: true })
