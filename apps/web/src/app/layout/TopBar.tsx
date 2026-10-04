import { toast } from 'sonner'
import { ROLES, ROLE_LABELS, type Role } from '@reclaim/shared'
import { useReset, useSettings, useUpdateSettings } from '@/api'
import { useUi } from '@/store/ui'
import { AgentStatusBadge } from '@/components/domain/AgentStatusBadge'
import { ModeSwitch } from '@/components/domain/ModeSwitch'
import { ThemeToggle } from '@/components/domain/ThemeToggle'
import { Button } from '@/components/ui/button'

export function TopBar() {
  const { data: s } = useSettings()
  const upd = useUpdateSettings()
  const reset = useReset()
  const { role, setRole } = useUi()
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 overflow-hidden border-b border-line bg-surface px-5">
      <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
        <span className="text-sm font-semibold tracking-tight">Returns &amp; Credit Note agent</span>
      </div>
      <AgentStatusBadge />
      <div className="ml-auto flex items-center gap-3 whitespace-nowrap">
        <ModeSwitch
          label="SAP"
          value={s?.sapMode ?? 'mock'}
          options={[
            { value: 'mock', label: 'Mock' },
            { value: 'real', label: 'DS4' },
          ]}
          onChange={(v) => upd.mutate({ sapMode: v as 'mock' | 'real' })}
        />
        <ModeSwitch
          label="AI"
          value={s?.aiMode ?? 'assisted'}
          options={[
            { value: 'assisted', label: 'Assisted' },
            { value: 'rules_only', label: 'Rules only' },
          ]}
          onChange={(v) => upd.mutate({ aiMode: v as 'assisted' | 'rules_only' })}
        />
        <ModeSwitch
          label="SAP conflict"
          tone="warn"
          value={s?.simulateConflict ? 'on' : 'off'}
          options={[
            { value: 'off', label: 'OK' },
            { value: 'on', label: '412' },
          ]}
          onChange={(v) => upd.mutate({ simulateConflict: v === 'on' })}
        />
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted">Role</span>
          <select
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="h-7 max-w-[11rem] rounded-md border border-line bg-surface px-2 text-xs"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <ThemeToggle />
        <Button
          variant="outline"
          size="sm"
          onClick={() => reset.mutate(undefined, { onSuccess: () => toast.success('Demo reset') })}
        >
          Reset demo
        </Button>
      </div>
    </header>
  )
}
