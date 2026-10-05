import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

/** Turns texts into vectors. One vector per text, same order. */
export interface Embedder {
  readonly name: string
  embed(texts: string[]): Promise<number[][]>
}

/**
 * Cohere Embed Multilingual v3 on Amazon Bedrock: one meaning space for English, German and Romanian complaints,
 * same AWS account and EU region as the model. `input_type: clustering` is the mode meant for grouping.
 */
export class BedrockEmbedder implements Embedder {
  readonly name: string
  private client: BedrockRuntimeClient

  constructor(private modelId = process.env.EMBEDDING_MODEL ?? 'cohere.embed-multilingual-v3') {
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION ?? 'eu-central-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
    this.name = `${modelId} (bedrock)`
  }

  static fromEnv(): BedrockEmbedder | null {
    return process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? new BedrockEmbedder()
      : null
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = []
    for (let i = 0; i < texts.length; i += 96) {
      const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 2000))
      const res = await this.client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: 'application/json',
          body: JSON.stringify({ texts: batch, input_type: 'clustering', truncate: 'END' }),
        }),
      )
      const json = JSON.parse(new TextDecoder().decode(res.body)) as { embeddings: number[][] }
      out.push(...json.embeddings)
    }
    return out
  }
}

export const textHash = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 32)

/**
 * Embeddings kept in Supabase (pgvector, table `complaint_embeddings`), keyed by complaint id and model, with a hash
 * of the text so an edited complaint is embedded again. A memory copy sits in front; if the table is missing or the
 * database fails, the memory copy carries on and the briefing says where the vectors came from.
 */
export class VectorCache {
  private memory = new Map<string, number[]>()
  private db: SupabaseClient | null
  private dbOk = true

  constructor(
    db: SupabaseClient | null,
    private log: (msg: string) => void = () => undefined,
  ) {
    this.db = db
  }

  static fromEnv(log?: (msg: string) => void): VectorCache {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    return new VectorCache(
      url && key ? createClient(url, key, { auth: { persistSession: false } }) : null,
      log,
    )
  }

  get store(): string {
    return this.db && this.dbOk ? 'Supabase pgvector' : 'memory'
  }

  /** Vectors for every item, embedding only what is not cached yet. */
  async vectors(
    items: { id: string; text: string }[],
    embedder: Embedder,
  ): Promise<{ vectors: number[][]; embedded: number }> {
    const key = (id: string, text: string) => `${embedder.name}|${id}|${textHash(text)}`
    const missing = items.filter((x) => !this.memory.has(key(x.id, x.text)))
    if (missing.length && this.db && this.dbOk) {
      const { data, error } = await this.db
        .from('complaint_embeddings')
        .select('id, text_hash, embedding')
        .eq('model', embedder.name)
        .in(
          'id',
          missing.map((x) => x.id),
        )
      if (error) {
        this.dbOk = false
        this.log(
          `Vector store unavailable (${error.message}); run apps/api/supabase/schema.sql. Keeping vectors in memory.`,
        )
      } else {
        for (const row of data ?? []) {
          const vec =
            typeof row.embedding === 'string'
              ? (JSON.parse(row.embedding) as number[])
              : (row.embedding as number[])
          const item = missing.find((x) => x.id === row.id && textHash(x.text) === row.text_hash)
          if (item) this.memory.set(key(item.id, item.text), vec)
        }
      }
    }
    const todo = items.filter((x) => !this.memory.has(key(x.id, x.text)))
    if (todo.length) {
      const fresh = await embedder.embed(todo.map((x) => x.text))
      todo.forEach((x, i) => this.memory.set(key(x.id, x.text), fresh[i]!))
      if (this.db && this.dbOk) {
        const rows = todo.map((x, i) => ({
          id: x.id,
          model: embedder.name,
          text_hash: textHash(x.text),
          embedding: JSON.stringify(fresh[i]),
          updated_at: new Date().toISOString(),
        }))
        const { error } = await this.db
          .from('complaint_embeddings')
          .upsert(rows, { onConflict: 'id,model' })
        if (error) this.log(`Could not store ${rows.length} embeddings: ${error.message}`)
      }
    }
    return { vectors: items.map((x) => this.memory.get(key(x.id, x.text))!), embedded: todo.length }
  }
}
