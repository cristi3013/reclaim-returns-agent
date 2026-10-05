import { useState, type FormEvent } from 'react'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LogoMark } from '@/components/brand/Logo'
import { useAuth } from './AuthProvider'

/** Email and password, nothing else: the role comes with the account. */
export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-fg">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-card" aria-label="Sign in">
        <div className="mb-5 flex items-center gap-2">
          <LogoMark className="size-7" />
          <span className="font-semibold tracking-tight">Reclaim</span>
          <span className="text-sm text-muted">· Returns &amp; Credit Note agent</span>
        </div>
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Your account decides what you may approve. Nothing reaches SAP without a named person.</p>
        <label className="mt-4 block text-sm">
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-3" />
        </label>
        <label className="mt-3 block text-sm">
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-3" />
        </label>
        {error && (
          <p role="alert" className="mt-3 rounded-md border border-bad bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <Button type="submit" className="mt-4 w-full" disabled={busy || !email || !password}>
          <LogIn className="size-4" /> {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  )
}
