import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useUi } from '@/store/ui'
import type { AuthClient, AuthSession } from './client'

interface AuthState {
  status: 'loading' | 'signed_out' | 'signed_in'
  user: AuthSession['user'] | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

/** Holds the session and keeps the UI's role equal to the signed-in user's role. */
export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    client.getSession().then((s) => alive && setSession(s))
    const off = client.onChange((s) => alive && setSession(s))
    return () => {
      alive = false
      off()
    }
  }, [client])
  useEffect(() => {
    if (session?.user) useUi.getState().setRole(session.user.role)
  }, [session])
  const value: AuthState = {
    status: session === undefined ? 'loading' : session ? 'signed_in' : 'signed_out',
    user: session?.user ?? null,
    signIn: (email, password) => client.signIn(email, password),
    signOut: () => client.signOut(),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AuthProvider missing')
  return v
}
