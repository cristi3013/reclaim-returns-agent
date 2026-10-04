import { Sun, Moon, Monitor } from 'lucide-react'
import { useUi } from '@/store/ui'

export function ThemeToggle() {
  const { theme, setTheme } = useUi()
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${theme}. Switch to ${next}`}
      title={`Theme: ${theme}`}
      className="rounded-md border border-line bg-surface p-1.5 text-muted hover:text-fg"
    >
      <Icon className="size-4" />
    </button>
  )
}
