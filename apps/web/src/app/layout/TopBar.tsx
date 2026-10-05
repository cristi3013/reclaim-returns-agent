import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { ROLES, ROLE_LABELS, type Role } from '@reclaim/shared'
import { useReset, useSettings, useUpdateSettings } from '@/api'
import { useUi } from '@/store/ui'
import { useIsMobile } from '@/lib/useIsMobile'
import { AgentStatusBadge } from '@/components/domain/AgentStatusBadge'
import { ModeSwitch } from '@/components/domain/ModeSwitch'
import { ThemeToggle } from '@/components/domain/ThemeToggle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function TopBar() {
  const { data: s } = useSettings()
  const upd = useUpdateSettings()
  const reset = useReset()
  const { role, setRole } = useUi()
  const mobile = useIsMobile()
  const [menu, setMenu] = useState(false)

  // Demo controls: inline on a desktop, behind a menu on a phone.
  const demoControls = (
    <div className={cn('flex items-center gap-3 whitespace-nowrap', mobile && 'flex-col items-stretch gap-3')}>
      <ModeSwitch
        label="SAP"
        value={s?.sapMode ?? 'mock'}
        options={[
          { value: 'mock', label: 'Mock' },
          { value: 'real', label: 'DS4' },
        ]}
        onChange={(v) =>
          upd.mutate({ sapMode: v as 'mock' | 'real' }, { onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not switch SAP mode', { duration: 8000 }) })
        }
      />
      <ModeSwitch
        label="AI"
        value={s?.aiMode ?? 'assisted'}
        options={[
          { value: 'assisted', label: 'Assisted' },
          { value: 'rules_only', label: 'Rules only' },
        ]}
        onChange={(v) => upd.mutate({ aiMode: v as 'assisted' | 'rules_only' }, { onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not switch AI mode') })}
      />
      <ModeSwitch
        label="Conflict"
        tone="warn"
        value={s?.simulateConflict ? 'on' : 'off'}
        options={[
          { value: 'off', label: 'OK' },
          { value: 'on', label: '412' },
        ]}
        onChange={(v) => upd.mutate({ simulateConflict: v === 'on' })}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => reset.mutate(undefined, { onSuccess: () => toast.success('Demo reset') })}
      >
        Reset demo
      </Button>
    </div>
  )

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-4 md:gap-3 md:px-5">
      <span className="hidden shrink-0 whitespace-nowrap text-sm font-semibold tracking-tight 2xl:inline">Returns &amp; Credit Note agent</span>
      <AgentStatusBadge />
      <div className="ml-auto flex items-center gap-2 whitespace-nowrap md:gap-3">
        {!mobile && demoControls}
        <label className="flex items-center gap-2 text-xs">
          <span className="hidden text-muted sm:inline">Role</span>
          <select
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="h-7 max-w-[8rem] rounded-md border border-line bg-surface px-2 text-xs sm:max-w-[10rem]"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <ThemeToggle />
        {mobile && (
          <button
            type="button"
            aria-label="Demo controls"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            className={cn('rounded-md border border-line bg-surface p-1.5 text-muted hover:text-fg', menu && 'text-fg')}
          >
            <SlidersHorizontal className="size-4" />
          </button>
        )}
      </div>
      {mobile && menu && (
        <div className="absolute inset-x-0 top-full z-30 border-b border-line bg-surface p-4 shadow-card">{demoControls}</div>
      )}
    </header>
  )
}
