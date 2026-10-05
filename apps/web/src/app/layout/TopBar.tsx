import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { ROLE_LABELS } from '@reclaim/shared'
import { useReset, useSettings, useUpdateSettings } from '@/api'
import { useAuth } from '@/auth'
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
  const { user, signOut } = useAuth()
  const mobile = useIsMobile()
  const [menu, setMenu] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      ) {
        setMenu(false)
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [menu])

  const sap = s?.sapMode === 'real' ? 'DS4' : 'Mock'
  const ai = s?.aiMode === 'rules_only' ? 'Rules only' : 'AI assisted'

  // Demo switches: one button that shows the current state, the switches behind it.
  const demoControls = (
    <div className="grid gap-4">
      <Setting
        title="SAP system"
        hint="Mock is safe for rehearsals. DS4 writes to the real test system."
      >
        <ModeSwitch
          showLabel={false}
          label="SAP"
          value={s?.sapMode ?? 'mock'}
          options={[
            { value: 'mock', label: 'Mock' },
            { value: 'real', label: 'DS4' },
          ]}
          onChange={(v) =>
            upd.mutate(
              { sapMode: v as 'mock' | 'real' },
              {
                onError: (e) =>
                  toast.error(e instanceof Error ? e.message : 'Could not switch SAP mode', {
                    duration: 8000,
                  }),
              },
            )
          }
        />
      </Setting>
      <Setting
        title="Reading the emails"
        hint="Rules only skips the language model; the decisions stay the same."
      >
        <ModeSwitch
          showLabel={false}
          label="AI"
          value={s?.aiMode ?? 'assisted'}
          options={[
            { value: 'assisted', label: 'Assisted' },
            { value: 'rules_only', label: 'Rules only' },
          ]}
          onChange={(v) =>
            upd.mutate(
              { aiMode: v as 'assisted' | 'rules_only' },
              {
                onError: (e) =>
                  toast.error(e instanceof Error ? e.message : 'Could not switch AI mode'),
              },
            )
          }
        />
      </Setting>
      <Setting
        title="Simulate a SAP conflict"
        hint="412 makes the next SAP write fail as if someone changed the record."
      >
        <ModeSwitch
          showLabel={false}
          label="Conflict"
          tone="warn"
          value={s?.simulateConflict ? 'on' : 'off'}
          options={[
            { value: 'off', label: 'OK' },
            { value: 'on', label: '412' },
          ]}
          onChange={(v) => upd.mutate({ simulateConflict: v === 'on' })}
        />
      </Setting>
      <div className="border-t border-line pt-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            if (
              window.confirm(
                'Reset the demo? The eight demo cases are removed and settings go back to defaults. Complaints from emails, uploads and typed complaints are kept.',
              )
            ) {
              reset.mutate(undefined, {
                onSuccess: () =>
                  toast.success('Demo reset: demo cases removed, real complaints kept'),
              })
            }
          }}
        >
          Reset demo
        </Button>
      </div>
    </div>
  )

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur md:gap-3 md:px-6">
      <AgentStatusBadge />
      <div className="ml-auto flex items-center gap-2 whitespace-nowrap md:gap-3">
        <div ref={box} className="relative">
          <button
            type="button"
            aria-label="Demo controls"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            className={cn(
              'flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-xs text-muted hover:text-fg',
              menu && 'bg-surface-2 text-fg',
            )}
          >
            <SlidersHorizontal className="size-4" />
            {!mobile && (
              <>
                <span>
                  <span className="text-fg">SAP {sap}</span> · {ai}
                </span>
                {s?.simulateConflict && (
                  <span className="rounded bg-warn-soft px-1.5 font-medium text-warn">412 on</span>
                )}
                <ChevronDown className="size-3.5" />
              </>
            )}
          </button>
          {menu && (
            <div
              className={cn(
                'absolute top-full z-40 mt-2 whitespace-normal rounded-xl border border-line bg-surface p-4 shadow-lg',
                mobile ? '-right-24 w-[min(20rem,calc(100vw-2rem))]' : 'right-0 w-80',
              )}
            >
              <div className="mb-3 text-sm font-semibold">Demo settings</div>
              {demoControls}
            </div>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-2 text-xs" aria-label="Signed in as">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-fg"
              aria-hidden
            >
              {initials(user.name)}
            </span>
            <span className="hidden min-w-0 leading-tight sm:block">
              <span className="block max-w-[12rem] truncate font-medium" title={user.email}>
                {user.name}
              </span>
              <span className="block text-muted">{ROLE_LABELS[user.role]}</span>
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="rounded-lg border border-line bg-surface p-1.5 text-muted hover:text-fg"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        )}
        <ThemeToggle />
      </div>
    </header>
  )
}

function Setting({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{title}</span>
      {children}
      <p className="text-xs leading-snug text-muted">{hint}</p>
    </div>
  )
}

/** "Dana Credit" → "DC" */
function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return (
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() ||
    '?'
  )
}
