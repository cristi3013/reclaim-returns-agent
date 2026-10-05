import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { ROLES, type Role } from '@reclaim/shared'

/** Who is calling: taken from the signed Supabase session token, never from the request body. */
export interface Principal {
  id: string
  email: string
  name: string
  role: Role
}

export interface Verifier {
  /** Resolves the principal for a bearer token, or throws an AuthError. `null` means no token was sent. */
  verify(token: string | null): Promise<Principal>
}

export class AuthError extends Error {
  status = 401
}

/**
 * Verifies Supabase Auth tokens with the project's public signing keys (JWKS, ES256). The role comes from
 * `app_metadata.role`, which only the service key can set: a user cannot promote themselves.
 */
export function supabaseVerifier(supabaseUrl: string, getKey?: JWTVerifyGetKey): Verifier {
  const base = supabaseUrl.replace(/\/$/, '')
  const keys = getKey ?? createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`))
  return {
    async verify(token) {
      if (!token) throw new AuthError('Sign in to use Reclaim.')
      let payload
      try {
        payload = (await jwtVerify(token, keys, { issuer: `${base}/auth/v1`, audience: 'authenticated' })).payload
      } catch {
        throw new AuthError('Your session is not valid any more. Sign in again.')
      }
      const app = (payload.app_metadata ?? {}) as { role?: string }
      const role = (ROLES as readonly string[]).includes(app.role ?? '') ? (app.role as Role) : null
      if (!role) throw new AuthError('Your account has no role yet. Ask an administrator to assign one.')
      const user = (payload.user_metadata ?? {}) as { name?: string; full_name?: string }
      const email = String(payload.email ?? '')
      return { id: String(payload.sub ?? ''), email, name: user.name ?? user.full_name ?? email, role }
    },
  }
}

/**
 * For tests only: the bearer token is `<role>:<name>`; no token means the demo credit manager; the word
 * "invalid" is refused. Nothing in the product uses this.
 */
export function headerVerifier(): Verifier {
  return {
    async verify(token) {
      if (token === 'invalid') throw new AuthError('Your session is not valid any more. Sign in again.')
      const [role, name] = (token ?? 'credit_manager:Demo').split(':')
      if (!(ROLES as readonly string[]).includes(role ?? '')) throw new AuthError('Your account has no role yet. Ask an administrator to assign one.')
      return { id: `test-${role}`, email: `${role}@reclaim.test`, name: name ?? 'Demo', role: role as Role }
    },
  }
}
