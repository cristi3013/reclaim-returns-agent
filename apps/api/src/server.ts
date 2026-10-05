import { buildApp } from './app'
import { detectProvider } from './ai/claude'

const port = Number(process.env.PORT ?? 3000)
const { app, ready } = buildApp({
  initialSettings: {
    sapMode: process.env.SAP_MODE === 'real' ? 'real' : 'mock',
    aiMode: process.env.AI_MODE === 'rules_only' ? 'rules_only' : 'assisted',
  },
  gatewayUrl: process.env.GATEWAY_URL,
})

app
  .listen({ port, host: '0.0.0.0' })
  .then(async () => {
    try {
      await ready()
    } catch (e) {
      app.log.error((e as Error).message)
    }
    app.log.info(
      `Reclaim API on :${port} · SAP ${process.env.SAP_MODE ?? 'mock'} · AI ${detectProvider() ? `${process.env.AI_MODE ?? 'assisted'} via ${detectProvider()}` : 'rules_only (no ANTHROPIC_API_KEY and no AWS keys)'}`,
    )
  })
  .catch((e) => {
    app.log.error(e)
    process.exit(1)
  })
