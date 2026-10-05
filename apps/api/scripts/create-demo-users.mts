/**
 * Creates (or updates) the four demo accounts, one per role, in Supabase Auth. Run from apps/api with the
 * backend's .env loaded:  set -a; source .env; set +a; npx tsx scripts/create-demo-users.mts
 * The role lives in app_metadata, which only this service key can write.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required')
const password = process.env.DEMO_PASSWORD ?? 'Reclaim-2026'

const USERS = [
  { email: 'cs.lead@reclaim.demo', name: 'Clara Lead', role: 'customer_service_lead' },
  { email: 'credit.manager@reclaim.demo', name: 'Dana Credit', role: 'credit_manager' },
  { email: 'finance.director@reclaim.demo', name: 'Felix Finance', role: 'finance_director' },
  { email: 'returns.desk@reclaim.demo', name: 'Rita Returns', role: 'returns_desk' },
]

const sb = createClient(url, key, { auth: { persistSession: false } })
const { data: existing, error: listErr } = await sb.auth.admin.listUsers({ perPage: 200 })
if (listErr) throw listErr
for (const u of USERS) {
  const found = existing.users.find((x) => x.email?.toLowerCase() === u.email)
  const attrs = { email: u.email, password, email_confirm: true, app_metadata: { role: u.role }, user_metadata: { name: u.name } }
  const r = found ? await sb.auth.admin.updateUserById(found.id, attrs) : await sb.auth.admin.createUser(attrs)
  if (r.error) throw r.error
  console.log(`${found ? 'updated' : 'created'}  ${u.email.padEnd(32)} ${u.role.padEnd(22)} ${u.name}`)
}
console.log(`\npassword for all four: ${password}`)
