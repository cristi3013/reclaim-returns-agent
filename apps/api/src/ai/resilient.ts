import type { Ai } from './types'

/** Errors worth another try: the model is busy or briefly unavailable, not our request. */
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])
const isRetryable = (e: unknown) => {
  const err = e as Error & { status?: number; code?: string }
  return err.status === undefined ? true : RETRYABLE.has(err.status)
}

export interface ResilientOptions {
  attempts?: number
  /** Backoff in ms before attempt 2, 3, … */
  delaysMs?: number[]
  sleep?: (ms: number) => Promise<void>
}

/**
 * The model, with patience and a safety net. A busy Bedrock (429/503) is retried with backoff; if it still fails,
 * the rules-only reader takes over so the case gets its proposal. The decision never came from the model anyway;
 * what degrades is the quality of the facts read from the email and the wording of the explanation. The pipeline
 * records the fallback in the audit trail.
 */
export class ResilientAi implements Ai {
  readonly name: string
  private attempts: number
  private delays: number[]
  private sleep: (ms: number) => Promise<void>

  constructor(
    private primary: Ai,
    private fallback: Ai,
    opts: ResilientOptions = {},
  ) {
    this.name = primary.name
    this.attempts = opts.attempts ?? 3
    this.delays = opts.delaysMs ?? [1500, 4000]
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  private async withFallback<T extends object>(run: (ai: Ai) => Promise<T>): Promise<T & { fallback?: string }> {
    let last: unknown
    for (let i = 0; i < this.attempts; i++) {
      try {
        return await run(this.primary)
      } catch (e) {
        last = e
        if (!isRetryable(e)) break
        if (i < this.attempts - 1) await this.sleep(this.delays[Math.min(i, this.delays.length - 1)] ?? 1000)
      }
    }
    const err = last as Error & { status?: number }
    const result = await run(this.fallback)
    return { ...result, fallback: `${this.primary.name} failed ${this.attempts} time(s) (${err?.status ?? 'error'}: ${(err?.message ?? '').slice(0, 120)}); ${this.fallback.name} took over` }
  }

  extractFacts(...args: Parameters<Ai['extractFacts']>) {
    return this.withFallback((ai) => ai.extractFacts(...args))
  }

  narrate(...args: Parameters<Ai['narrate']>) {
    return this.withFallback((ai) => ai.narrate(...args))
  }
}
