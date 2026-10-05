import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SettingsSchema, type Settings } from '@reclaim/shared'
import { z } from 'zod'
import { Store } from './store'
import { EventHub } from './events'
import { Service } from './service'
import { MockGateway } from './gateway/mock'
import { RealGateway } from './gateway/real'
import { RulesOnlyAi } from './ai/rules-only'
import { ClaudeAi, detectProvider } from './ai/claude'
import type { Gateway } from './gateway/types'
import type { Ai } from './ai/types'
import { SupabasePersistence } from './persistence'
import { MailboxListener, mailboxConfigFromEnv, parseEml } from './intake/mailbox'
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
  attachments: z.array(z.object({ name: z.string(), mimeType: z.string(), url: z.string() })).default([]),
})

const ApproveBody = z.object({ actor: z.string(), role: z.enum(['customer_service_lead', 'credit_manager', 'finance_director', 'returns_desk']), editedQuantity: z.number().optional(), comment: z.string().optional() })
const RejectBody = ApproveBody.pick({ actor: true, role: true }).extend({ comment: z.string() })
const ReleaseBody = ApproveBody.pick({ actor: true, role: true })
const ReplyBody = ApproveBody.pick({ actor: true, role: true }).extend({ text: z.string().optional() })

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
}

/** Builds the Fastify app. `server.ts` listens; tests use `app.inject`. */
export function buildApp(opts: AppOptions = {}): { app: FastifyInstance; service: Service; store: Store; ready: () => Promise<void>; stop: () => void } {
  const store = new Store(opts.initialSettings)
  const publicBase = opts.publicBase ?? process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
  const log = (msg: string) => (process.env.NODE_ENV === 'test' ? undefined : console.error(msg))
  const persistence = opts.noSideCars ? null : SupabasePersistence.fromEnv(log)
  const hub = new EventHub()
  const mailer = opts.mailer !== undefined ? opts.mailer : opts.noSideCars ? null : mailerFromEnv()
  const mock = new MockGateway({ simulateConflict: () => store.settings.simulateConflict, delayMs: opts.mockDelayMs })
  const real = opts.gatewayUrl ? new RealGateway(opts.gatewayUrl) : null
  const rulesOnly = new RulesOnlyAi()
  let claude: ClaudeAi | null = null

  const gateway = opts.gateway ?? ((s: Settings) => (s.sapMode === 'real' && real ? real : mock))
  const ai =
    opts.ai ??
    ((s: Settings) => {
      if (s.aiMode !== 'assisted' || !detectProvider()) return rulesOnly
      return (claude ??= new ClaudeAi())
    })

  let pollerRef: { status: () => { address: string; connected: boolean; lastMessageAt: string | null; lastError: string | null } } | null = null
  const service = new Service({
    store,
    hub,
    mailboxStatus: () => pollerRef?.status() ?? null,
    gateway: (s) => gateway(s, store),
    ai,
    hasRealGateway: !!real || !!opts.gateway,
    onReset: () => mock.reset(),
    persistence: persistence ?? undefined,
    mailer,
    log,
    readAttachment: async (url) => {
      try {
        const rel = url.startsWith(publicBase) ? url.slice(publicBase.length) : url
        const file = rel.startsWith('/uploads/') ? path.join(UPLOADS_DIR, rel.slice('/uploads/'.length)) : path.join(ATTACHMENT_ROOT, rel.replace(/^\//, ''))
        const base64 = (await readFile(file)).toString('base64')
        const mimeType = url.endsWith('.png') ? 'image/png' : url.endsWith('.jpg') || url.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream'
        return { mimeType, base64 }
      } catch {
        return null
      }
    },
  })

  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })
  app.register(cors, { origin: true })
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
      const mail = await parseEml(await part.toBuffer(), UPLOADS_DIR, publicBase, part.filename)
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
      s = await service.ingestInbound({ from: b.from, subject: b.subject, text: b.text, receivedAt: b.receivedAt ?? new Date().toISOString(), attachments: b.attachments, messageId: b.messageId ?? null, sourceFile: null })
    } else {
      const mail = await parseEml(req.body as Buffer, UPLOADS_DIR, publicBase, null)
      s = await service.ingestInbound(mail)
    }
    if (!s) return reply.status(200).send({ duplicate: true })
    if (process.env.INBOUND_AUTORUN !== 'false') void service.runCase(s.id).catch(() => undefined)
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
    const r = await service.sendReply(req.params.id, ReplyBody.parse(req.body))
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    return r.value
  })

  // Proposals and SAP
  app.post<{ Params: { id: string } }>('/api/proposals/:id/choose', async (req, reply) => {
    service.chooseProposal(req.params.id)
    reply.status(204)
  })
  app.post<{ Params: { id: string } }>('/api/proposals/:id/approve', async (req, reply) => {
    const r = await service.approve(req.params.id, ApproveBody.parse(req.body))
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    return r.value
  })
  app.post<{ Params: { id: string } }>('/api/proposals/:id/reject', async (req, reply) => {
    service.reject(req.params.id, RejectBody.parse(req.body))
    reply.status(204)
  })
  app.get<{ Params: { id: string } }>('/api/sap/:id/status', async (req) => service.returnStatus(req.params.id))
  app.post<{ Params: { id: string } }>('/api/sap/:id/goods-receipt', async (req, reply) => {
    const r = service.confirmGoodsReceipt(req.params.id, ReleaseBody.parse(req.body ?? {}))
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    return r.value
  })
  app.post<{ Params: { id: string } }>('/api/sap/:id/release', async (req, reply) => {
    const r = await service.release(req.params.id, ReleaseBody.parse(req.body ?? {}))
    if (!r.ok) return reply.status(r.status).send({ message: r.message, status: r.status })
    return r.value
  })

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
    await service.reset(req.ip)
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
          if (s && process.env.INBOUND_AUTORUN !== 'false') void service.runCase(s.id).catch(() => undefined)
        },
        UPLOADS_DIR,
        publicBase,
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
