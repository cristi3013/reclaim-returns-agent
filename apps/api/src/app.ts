import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CASE_STATUSES, SettingsSchema, type Settings } from '@reclaim/shared'
import { z } from 'zod'
import { Store } from './store'
import { EventHub } from './events'
import { Service } from './service'
import { MockGateway } from './gateway/mock'
import { RealGateway } from './gateway/real'
import { RulesOnlyAi } from './ai/rules-only'
import { ResilientAi } from './ai/resilient'
import { ClaudeAi, detectProvider } from './ai/claude'
import type { Gateway } from './gateway/types'
import { mimeFromName, type Ai } from './ai/types'
import { SupabasePersistence } from './persistence'
import { supabaseVerifier, type Principal, type Verifier } from './auth'
import { ControlTower } from './control-tower'
import { RootCauses } from './insights/root-causes'
import { BedrockEmbedder, VectorCache, type Embedder } from './insights/embeddings'

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal
  }
}
import { MailboxListener, mailboxConfigFromEnv, parseEml } from './intake/mailbox'
import { Files, LocalFiles, SupabaseFiles } from './files'
import { mailerFromEnv, type Mailer } from './intake/mailer'

const here = path.dirname(fileURLToPath(import.meta.url))
/** Attachments referenced by the demo cases live in the web app's public folder. */
const ATTACHMENT_ROOT = path.resolve(here, '../../web/public')
/** Attachments from real emails are saved here and served at /uploads/<file>. */
const UPLOADS_DIR = path.resolve(here, '../uploads')

const InboundBody = z.object({
  from: z.string().default('unknown sender'),
  subject: z.string(),
  text: z.string(),
  receivedAt: z.string().optional(),
  messageId: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  attachments: z.array(z.object({ name: z.string(), mimeType: z.string(), url: z.string() })).default([]),
})

// Who acts comes from the signed session token (req.principal); actor and role in a body are ignored.
const ApproveBody = z.object({ actor: z.string().optional(), role: z.string().optional(), editedQuantity: z.number().optional(), comment: z.string().optional() })
const RejectBody = ApproveBody.pick({ actor: true, role: true }).extend({ comment: z.string() })
const ReplyBody = ApproveBody.pick({ actor: true, role: true }).extend({ text: z.string().optional(), kind: z.enum(['decision', 'message']).optional(), replyTo: z.string().optional() })
const StatusBody = ApproveBody.pick({ actor: true, role: true }).extend({ to: z.enum(CASE_STATUSES), comment: z.string() })

export interface AppOptions {
  initialSettings?: Partial<Settings>
  /** Override for tests: a gateway factory. Default: MockGateway, or RealGateway when SAP_MODE=real. */
  gateway?: (settings: Settings, store: Store) => Gateway
  /** Override for tests. Default: ClaudeAi when assisted and ANTHROPIC_API_KEY is set, else RulesOnlyAi. */
  ai?: (settings: Settings) => Ai
  gatewayUrl?: string
  mockDelayMs?: number
  /** Public base URL of this API, used in attachment links. Default http://localhost:PORT. */
  publicBase?: string
  /** Disable Supabase, the mailbox poller and outgoing email (tests). */
  noSideCars?: boolean
  /** Override for tests: the outgoing mailer. Default: mailerFromEnv(), none with noSideCars. */
  mailer?: Mailer | null
  /** Token verifier. Default: Supabase Auth with the project's public keys. Tests pass `headerVerifier()`. */
  verifier?: Verifier
  /** Override for tests: the embedding model for root causes. Default: Cohere on Bedrock when AWS keys are set, none with noSideCars. */
  embedder?: Embedder | null
}

/** Builds the Fastify app. `server.ts` listens; tests use `app.inject`. */
export function buildApp(opts: AppOptions = {}): { app: FastifyInstance; service: Service; store: Store; ready: () => Promise<void>; stop: () => void } {
  const store = new Store(opts.initialSettings)
  const publicBase = opts.publicBase ?? process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
  const log = (msg: string) => (process.env.NODE_ENV === 'test' ? undefined : console.error(msg))
  const persistence = opts.noSideCars ? null : SupabasePersistence.fromEnv(log)
  const local = new LocalFiles(UPLOADS_DIR, publicBase)
  const cloud = opts.noSideCars ? null : SupabaseFiles.fromEnv()
  const files = cloud ? new Files(cloud, local) : local
  const hub = new EventHub()
  const mailer = opts.mailer !== undefined ? opts.mailer : opts.noSideCars ? null : mailerFromEnv()
  const mock = new MockGateway({ simulateConflict: () => store.settings.simulateConflict, delayMs: opts.mockDelayMs })
  const real = opts.gatewayUrl ? new RealGateway(opts.gatewayUrl) : null
  const rulesOnly = new RulesOnlyAi()
  let claude: ResilientAi | null = null

  // The product talks to DS4 through the gateway (GATEWAY_URL, required by server.ts). Tests inject a gateway or get the mock.
  const gateway = opts.gateway ?? (() => real ?? mock)
  const ai =
    opts.ai ??
    ((s: Settings) => {
      if (s.aiMode !== 'assisted' || !detectProvider()) return rulesOnly
      // Bedrock answers 503/429 now and then: retry, and fall back to the rules-only reader rather than fail the case.
      return (claude ??= new ResilientAi(new ClaudeAi(), rulesOnly))
    })

  let pollerRef: { status: () => { address: string; connected: boolean; lastMessageAt: string | null; lastError: string | null } } | null = null
  const service = new Service({
    store,
    hub,
    mailboxStatus: () => pollerRef?.status() ?? null,
    gateway: (s) => gateway(s, store),
    ai,
    onReset: () => {
      mock.reset()
      rootCauses.latest = null
    },
    persistence: persistence ?? undefined,
    mailer,
    log,
    readAttachment: async (url) => {
      try {
        // Fixture photos ('/mock/…') ship with the web app; everything else is in the file store.
        const bytes = url.startsWith('/') && !url.startsWith('/uploads/') ? await readFile(path.join(ATTACHMENT_ROOT, url.slice(1))) : await files.read(url)
        return bytes ? { mimeType: mimeFromName(url) ?? 'application/octet-stream', base64: bytes.toString('base64') } : null
      } catch {
        return null
      }
    },
  })

  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })
  app.register(cors, { origin: true })

  // Every API call carries a Supabase session token. Exceptions: the health check and the status endpoint
  // the Control Tower polls (read-only), and the inbound webhook (no user behind it).
  if (!opts.verifier && !process.env.SUPABASE_URL) throw new Error('SUPABASE_URL is required: sessions are verified against it.')
  const verifier = opts.verifier ?? supabaseVerifier(process.env.SUPABASE_URL ?? '')
  const PUBLIC = new Set(['/health', '/api/status', '/api/inbound'])
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? ''
    if (!path.startsWith('/api/') || PUBLIC.has(path)) return
    const h = req.headers.authorization
    // EventSource cannot send headers, so the live-updates stream takes the token as a query parameter.
    const token = h?.startsWith('Bearer ') ? h.slice(7) : path === '/api/events' ? ((req.query as { token?: string }).token ?? null) : null
    try {
      req.principal = await verifier.verify(token)
    } catch (e) {
      const err = e as Error & { status?: number }
      return reply.status(err.status ?? 401).send({ message: err.message, status: err.status ?? 401 })
    }
  })
  const who = (req: { principal: Principal }) => ({ actor: req.principal.name, role: req.principal.role })
  app.register(multipart, { limits: { files: 20, fileSize: 5 * 1024 * 1024 } })
  app.register(fastifyStatic, { root: UPLOADS_DIR, prefix: '/uploads/', decorateReply: false })

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as { status?: number; statusCode?: number; message?: string }
    const status = e.status ?? e.statusCode ?? 500
    reply.status(status).send({ message: e.message ?? 'Internal error', status })
  })

  // Cases
  app.get('/api/cases', async () => service.listCases())
  app.get<{ Params: { id: string } }>('/api/cases/:id', async (req) => service.getCase(req.params.id))
  app.post('/api/cases/seed', async (_req, reply) => {
    service.seed()
    reply.status(204)
  })
  app.post('/api/cases/ingest', async (req) => {
    const out = []
    for await (const part of req.files()) {
      const mail = await parseEml(await part.toBuffer(), files, part.filename)
      const s = await service.ingestInbound(mail)
      if (s) out.push(s)
    }
    return out
  })
  /**
   * Inbound complaint by webhook: JSON {from, subject, text, receivedAt?, messageId?, attachments?} or a raw
   * email with content-type message/rfc822 or text/plain. Use it from Postman, or from an email-to-webhook service.
   */
  app.addContentTypeParser(['message/rfc822', 'text/plain'], { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
  app.post('/api/inbound', async (req, reply) => {
    const ct = req.headers['content-type'] ?? ''
    let s
    if (ct.includes('application/json')) {
      const b = InboundBody.parse(req.body)
      s = await service.ingestInbound({ from: b.from, subject: b.subject, text: b.text, receivedAt: b.receivedAt ?? new Date().toISOString(), attachments: b.attachments, messageId: b.messageId ?? null, inReplyTo: b.inReplyTo ?? null, references: b.references ?? [], sourceFile: null })
    } else {
      const mail = await parseEml(req.body as Buffer, files, null)
      s = await service.ingestInbound(mail)
    }
    if (!s) return reply.status(200).send({ duplicate: true })
    // A new complaint, or a Pending case the customer just answered (back to Open): investigate it. Other replies only join the thread.
    if (s.status === 'received' && process.env.INBOUND_AUTORUN !== 'false') void service.runCase(s.id).catch(() => undefined)
    return reply.status(201).send(s)
  })
  app.post<{ Params: { id: string } }>('/api/cases/:id/run', async (req, reply) => {
    await service.runCase(req.params.id)
    reply.status(204)
  })
  app.post('/api/cases/run-all', async (_req, reply) => {
    await service.runAll()
    reply.status(204)
  })

  app.post<{ Params: { id: string } }>('/api/cases/:id/reply', async (req, reply) => {
    const r = await service.sendReply(req.params.id, { ...ReplyBody.parse(req.body), ...who(req) })
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    return r.value
  })

  app.get<{ Params: { id: string } }>('/api/cases/:id/reply-suggestion', async (req) => service.suggestReply(req.params.id))
  app.post<{ Params: { id: string } }>('/api/cases/:id/status', async (req, reply) => {
    const r = service.changeStatus(req.params.id, { ...StatusBody.parse(req.body), ...who(req) })
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    reply.status(204)
  })

  // Proposals and SAP
  app.post<{ Params: { id: string } }>('/api/proposals/:id/choose', async (req, reply) => {
    service.chooseProposal(req.params.id)
    reply.status(204)
  })
  app.post<{ Params: { id: string } }>('/api/proposals/:id/approve', async (req, reply) => {
    const r = await service.approve(req.params.id, { ...ApproveBody.parse(req.body), ...who(req) })
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    return r.value
  })
  app.post<{ Params: { id: string } }>('/api/proposals/:id/reject', async (req, reply) => {
    service.reject(req.params.id, { ...RejectBody.parse(req.body), ...who(req) })
    reply.status(204)
  })
  app.get<{ Params: { id: string } }>('/api/sap/:id/status', async (req) => service.returnStatus(req.params.id))
  app.post<{ Params: { id: string } }>('/api/sap/:id/goods-receipt', async (req, reply) => {
    const r = service.confirmGoodsReceipt(req.params.id, who(req))
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    return r.value
  })
  app.post<{ Params: { id: string } }>('/api/sap/:id/release', async (req, reply) => {
    const r = await service.release(req.params.id, who(req))
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    return r.value
  })

  // Control Tower (extra credit, agent 10): reads, computes, answers, routes. No write to SAP anywhere in it.
  const tower = new ControlTower({ store, ai, ingest: (m) => service.ingestInbound(m), log })
  app.get('/api/control-tower/snapshot', async () => tower.current())
  app.post('/api/control-tower/run', async (req) => tower.run(req.principal.name))
  app.post('/api/control-tower/ask', async (req) => tower.ask(z.object({ question: z.string().min(3) }).parse(req.body).question, req.principal.name))
  app.get('/api/control-tower/memo', async (_req, reply) => reply.type('text/markdown; charset=utf-8').send(tower.memo()))
  app.get('/api/control-tower/notes', async () => tower.notes())
  app.post<{ Params: { id: string } }>('/api/control-tower/handover/:id', async (req, reply) => {
    const r = await tower.handover(req.params.id, req.principal.name)
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    return r
  })

  // Root causes: groups similar complaints, the model names cause and fix, code computes the figures. Read-only.
  const rootCauses = new RootCauses({
    store,
    ai,
    embedder: opts.embedder !== undefined ? opts.embedder : opts.noSideCars ? null : BedrockEmbedder.fromEnv(),
    vectors: opts.noSideCars ? new VectorCache(null) : VectorCache.fromEnv(log),
    log,
  })
  app.get('/api/insights/root-causes', async () => ({ briefing: rootCauses.latest }))
  app.post('/api/insights/root-causes', async (req) => rootCauses.generate(req.principal.name))

  // Analytics, eval, status, settings
  app.get('/api/analytics/summary', async () => service.analytics())
  app.post('/api/eval/run', async () => service.runEval())
  app.get('/api/eval/latest', async () => store.evalResults)
  app.get('/api/status', async () => service.status())
  app.get('/api/settings', async () => service.getSettings())
  app.put('/api/settings', async (req, reply) => {
    const r = service.updateSettings(SettingsSchema.partial().parse(req.body))
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    return r.value
  })
  app.post('/api/demo/reset', async (req, reply) => {
    await service.reset(`${req.principal.name} (${req.principal.role}, ${req.ip})`)
    reply.status(204)
  })

  // Live updates: Server-Sent Events
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' })
    reply.raw.write(': connected\n\n')
    const off = hub.subscribe((e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`))
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000)
    req.raw.on('close', () => {
      off()
      clearInterval(ping)
    })
  })

  app.get('/health', async () => ({ ok: true, agent: 'o2c-agent-8', persistence: !!persistence, mailbox: !!mailboxConfigFromEnv() && !opts.noSideCars, reply: mailer?.from ?? null }))

  const mailboxCfg = opts.noSideCars ? null : mailboxConfigFromEnv()
  const poller = mailboxCfg
    ? new MailboxListener(
        mailboxCfg,
        async (mail) => {
          const s = await service.ingestInbound(mail)
          // The run takes seconds with the model; it must not block the mailbox fetch or the next email.
          if (s?.status === 'received' && process.env.INBOUND_AUTORUN !== 'false') void service.runCase(s.id).catch(() => undefined)
        },
        files,
        log,
      )
    : null

  // Several instances (laptop + Railway) share one database: each pulls the others' changes every few seconds.
  const syncMs = Number(process.env.SYNC_INTERVAL_MS ?? 10000)
  let syncTimer: NodeJS.Timeout | null = null
  const ready = async () => {
    if (persistence) {
      try {
        const n = await persistence.load(store)
        log(`Supabase: loaded ${n} cases`)
      } catch (e) {
        log((e as Error).message)
      }
      if (syncMs > 0) {
        let failures = 0
        syncTimer = setInterval(() => {
          service.syncFromPersistence().then(
            () => (failures = 0),
            (e) => failures++ === 0 && log((e as Error).message),
          )
        }, syncMs)
        syncTimer.unref()
        log(`Supabase: syncing with other instances every ${syncMs / 1000}s`)
      }
    }
    poller?.start()
  }
  pollerRef = poller
  const stop = () => {
    poller?.stop()
    if (syncTimer) clearInterval(syncTimer)
  }

  return { app, service, store, ready, stop }
}
