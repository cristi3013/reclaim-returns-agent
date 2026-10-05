import { describe, it, expect } from 'vitest'
import { generateKeyPair, SignJWT, exportJWK } from 'jose'
import { supabaseVerifier } from '../src/auth'

/** Tokens signed with a throw-away ES256 key, the way Supabase signs them; the verifier gets the public key. */
async function setup() {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const jwk = await exportJWK(publicKey)
  const verifier = supabaseVerifier('https://proj.supabase.co', async () => publicKey)
  const sign = (claims: Record<string, unknown>, opts: { issuer?: string; audience?: string; exp?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: String(jwk.kid ?? 'k1') })
      .setIssuer(opts.issuer ?? 'https://proj.supabase.co/auth/v1')
      .setAudience(opts.audience ?? 'authenticated')
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '1h')
      .sign(privateKey)
  return { verifier, sign }
}

describe('supabaseVerifier', () => {
  it('accepts a valid token and reads the role from app_metadata', async () => {
    const { verifier, sign } = await setup()
    const token = await sign({ email: 'dana@acme.example', app_metadata: { role: 'credit_manager' }, user_metadata: { name: 'Dana' } })
    expect(await verifier.verify(token)).toEqual({ id: 'user-1', email: 'dana@acme.example', name: 'Dana', role: 'credit_manager' })
  })

  it('refuses no token, a tampered or expired token, a wrong issuer, and an account without a role', async () => {
    const { verifier, sign } = await setup()
    await expect(verifier.verify(null)).rejects.toMatchObject({ status: 401, message: /sign in/i })
    const good = await sign({ email: 'x@y', app_metadata: { role: 'credit_manager' } })
    await expect(verifier.verify(good.slice(0, -4) + 'AAAA')).rejects.toMatchObject({ status: 401 })
    await expect(verifier.verify(await sign({ email: 'x@y', app_metadata: { role: 'credit_manager' } }, { exp: '-1m' }))).rejects.toMatchObject({ status: 401 })
    await expect(verifier.verify(await sign({ email: 'x@y', app_metadata: { role: 'credit_manager' } }, { issuer: 'https://evil.example/auth/v1' }))).rejects.toMatchObject({ status: 401 })
    await expect(verifier.verify(await sign({ email: 'x@y', app_metadata: { role: 'ceo' } }))).rejects.toMatchObject({ status: 401, message: /no role/i })
    await expect(verifier.verify(await sign({ email: 'x@y' }))).rejects.toMatchObject({ status: 401, message: /no role/i })
  })
})
