import { z } from 'zod'

/** Token usage of one model call, as the API reports it. Stored in the case's audit event. */
export const ModelUsageSchema = z.object({
  model: z.string(),
  purpose: z.enum(['extract', 'narrate', 'insights']),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  latencyMs: z.number(),
})
export type ModelUsage = z.infer<typeof ModelUsageSchema>

/** USD per million tokens, Anthropic list prices (Sep 2026). Bedrock bills separately; this is an estimate. */
const PRICES: { match: RegExp; input: number; output: number; cacheRead: number; cacheWrite: number }[] = [
  { match: /fable-5|mythos-5/, input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  { match: /opus-5-5/, input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  { match: /opus-5|opus-4-8|opus-4-7|opus-4-6/, input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { match: /sonnet-5-5|sonnet-5/, input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { match: /sonnet-4/, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { match: /haiku-4-5/, input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
]

export function estimateCostUsd(u: Pick<ModelUsage, 'model' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number {
  const p = PRICES.find((x) => x.match.test(u.model)) ?? { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  const usd = (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1_000_000
  return Math.round(usd * 1_000_000) / 1_000_000
}
