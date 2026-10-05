import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
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
import { ClaudeAi } from './ai/claude'
import type { Gateway } from './gateway/types'
import type { Ai } from './ai/types'

const here = path.dirname(fileURLToPath(import.meta.url))
/** Attachments referenced by the demo cases live in the web app's public folder. */
const ATTACHMENT_ROOT = path.resolve(here, '../../web/public')

const ApproveBody = z.object({ actor: z.string(), role: z.enum(['customer_service_lead', 'credit_manager', 'finance_director', 'returns_desk']), editedQuantity: z.number().optional(), comment: z.string().optional() })
const RejectBody = ApproveBody.pick({ actor: true, role: true }).extend({ comment: z.string() })
const ReleaseBody = ApproveBody.pick({ actor: true, role: true }).extend({ goodsReceived: z.boolean().optional() })

export interface AppOptions {
  initialSettings?: Partial<Settings>
  /** Override for tests: a gateway factory. Default: MockGateway, or RealGateway when SAP_MODE=real. */
  gateway?: (settings: Settings, store: Store) => Gateway
  /** Override for tests. Default: ClaudeAi when assisted and ANTHROPIC_API_KEY is set, else RulesOnlyAi. */
  ai?: (settings: Settings) => Ai
  gatewayUrl?: string
  mockDelayMs?: number
}

/** Builds the Fastify app. `server.ts` listens; tests use `app.inject`. */
export function buildApp(opts: AppOptions = {}): { app: FastifyInstance; service: Service; store: Store } {
  const store = new Store(opts.initialSettings)
  const hub = new EventHub()
  const mock = new MockGateway({ simulateConflict: () => store.settings.simulateConflict, delayMs: opts.mockDelayMs })
  const real = opts.gatewayUrl ? new RealGateway(opts.gatewayUrl) : null
  const rulesOnly = new RulesOnlyAi()
  let claude: ClaudeAi | null = null

  const gateway = opts.gateway ?? ((s: Settings) => (s.sapMode === 'real' && real ? real : mock))
  const ai =
    opts.ai ??
    ((s: Settings) => {
      if (s.aiMode !== 'assisted' || !process.env.ANTHROPIC_API_KEY) return rulesOnly
      return (claude ??= new ClaudeAi())
    })

  const service = new Service({
    store,
    hub,
    gateway: (s) => gateway(s, store),
    ai,
    hasRealGateway: !!real || !!opts.gateway,
    onReset: () => mock.reset(),
    readAttachment: async (url) => {
      try {
        const file = path.join(ATTACHMENT_ROOT, url.replace(/^\//, ''))
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
    const files: { name: string; text: string }[] = []
    for await (const part of req.files()) files.push({ name: part.filename, text: (await part.toBuffer()).toString('utf8') })
    return service.ingest(files)
  })
  app.post<{ Params: { id: string } }>('/api/cases/:id/run', async (req, reply) => {
    await service.runCase(req.params.id)
    reply.status(204)
  })
  app.post('/api/cases/run-all', async (_req, reply) => {
    await service.runAll()
    reply.status(204)
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
  app.post('/api/demo/reset', async (_req, reply) => {
    service.reset()
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

  app.get('/health', async () => ({ ok: true, agent: 'o2c-agent-8' }))

  return { app, service, store }
}
