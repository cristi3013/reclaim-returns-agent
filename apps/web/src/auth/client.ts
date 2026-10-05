import { createClient, type Session } from '@supabase/supabase-js'
import { ROLES, type Role } from '@reclaim/shared'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
}
export interface AuthSession {
  user: AuthUser
  token: string
}

/** What the app needs from an identity provider. Production: Supabase Auth. Tests: `fakeAuth`. */
export interface AuthClient {
  getSession(): Promise<AuthSession | null>
  onChange(cb: (s: AuthSession | null) => void): () => void
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  /** A fresh access token for API calls, or null when signed out. */
  getToken(): Promise<string | null>
}

function toSession(s: Session | null): AuthSession | null {
  if (!s?.user) return null
  const role = (s.user.app_metadata as { role?: string } | undefined)?.role
  const meta = (s.user.user_metadata ?? {}) as { name?: string; full_name?: string }
  const email = s.user.email ?? ''
  return {
    token: s.access_token,
    user: {
      id: s.user.id,
      email,
      name: meta.name ?? meta.full_name ?? email,
      // No role yet: the API refuses every call with a clear message, and the top bar says so.
      role: (ROLES as readonly string[]).includes(role ?? '') ? (role as Role) : 'returns_desk',
    },
  }
}

export function supabaseAuth(url: string, publishableKey: string): AuthClient {
  const sb = createClient(url, publishableKey, { auth: { persistSession: true, autoRefreshToken: true } })
  return {
    async getSession() {
      return toSession((await sb.auth.getSession()).data.session)
    },
    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, s) => cb(toSession(s)))
      return () => data.subscription.unsubscribe()
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message)
    },
    async signOut() {
      await sb.auth.signOut()
    },
    async getToken() {
      return (await sb.auth.getSession()).data.session?.access_token ?? null
    },
  }
}

/** For tests and stories: a fixed user, or nobody. */
export function fakeAuth(user: AuthUser | null): AuthClient {
  let current: AuthSession | null = user ? { user, token: `${user.role}:${user.name}` } : null
  const listeners = new Set<(s: AuthSession | null) => void>()
  const emit = () => listeners.forEach((l) => l(current))
  return {
    getSession: async () => current,
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async signIn(email) {
      current = { token: 'fake', user: { id: 'fake', email, name: email, role: 'credit_manager' } }
      emit()
    },
    async signOut() {
      current = null
      emit()
    },
    getToken: async () => current?.token ?? null,
  }
}
