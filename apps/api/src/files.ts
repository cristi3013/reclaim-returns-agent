import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Where the files that come with an email are kept. Cases live in Supabase and are shared by every instance
 * (laptop + Railway), so their files must too: a file on one server's disk is a broken image on the other,
 * and Railway empties its disk on every deploy. With Supabase configured the files go to a public Storage
 * bucket; without it (tests, offline) to the local uploads folder, served at /uploads/.
 */
export interface FileStore {
  /** Saves the file and returns the URL the case keeps. */
  save(name: string, content: Buffer, mimeType: string): Promise<string>
  /** The bytes behind a URL this store returned, or null. */
  read(url: string): Promise<Buffer | null>
}

export const BUCKET = 'attachments'

/** A unique, URL-safe name: a time prefix and the original name without odd characters. */
function storedName(name: string) {
  return `${Date.now().toString(36)}-${name.replace(/[^\w.-]+/g, '_')}`
}

export class LocalFiles implements FileStore {
  constructor(
    private dir: string,
    private publicBase: string,
  ) {}

  async save(name: string, content: Buffer) {
    await mkdir(this.dir, { recursive: true })
    const safe = storedName(name)
    await writeFile(path.join(this.dir, safe), content)
    return `${this.publicBase}/uploads/${safe}`
  }

  async read(url: string) {
    const rel = url.startsWith(this.publicBase) ? url.slice(this.publicBase.length) : url
    if (!rel.startsWith('/uploads/')) return null
    return readFile(path.join(this.dir, path.basename(rel))).catch(() => null)
  }
}

export class SupabaseFiles implements FileStore {
  private db: SupabaseClient
  private bucket: Promise<void> | null = null

  constructor(url: string, secretKey: string) {
    this.db = createClient(url, secretKey, { auth: { persistSession: false } })
  }

  static fromEnv(): SupabaseFiles | null {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    return url && key ? new SupabaseFiles(url, key) : null
  }

  /** Creates the public bucket the first time it is needed. */
  private ensureBucket() {
    return (this.bucket ??= (async () => {
      const { data } = await this.db.storage.getBucket(BUCKET)
      if (data) return
      const { error } = await this.db.storage.createBucket(BUCKET, { public: true })
      if (error && !/exist/i.test(error.message)) {
        this.bucket = null
        throw new Error(`Supabase Storage: cannot create bucket ${BUCKET}: ${error.message}`)
      }
    })())
  }

  async save(name: string, content: Buffer, mimeType: string) {
    await this.ensureBucket()
    const key = storedName(name)
    const { error } = await this.db.storage
      .from(BUCKET)
      .upload(key, content, { contentType: mimeType, upsert: false })
    if (error) throw new Error(`Supabase Storage upload of ${name} failed: ${error.message}`)
    return this.db.storage.from(BUCKET).getPublicUrl(key).data.publicUrl
  }

  async read(url: string) {
    const marker = `/object/public/${BUCKET}/`
    const i = url.indexOf(marker)
    if (i < 0) return null
    const { data, error } = await this.db.storage
      .from(BUCKET)
      .download(decodeURIComponent(url.slice(i + marker.length)))
    return error || !data ? null : Buffer.from(await data.arrayBuffer())
  }
}

/** Supabase Storage first; a local file is still found, for cases saved before. */
export class Files implements FileStore {
  constructor(
    private primary: FileStore,
    private fallback: FileStore | null = null,
  ) {}

  save(name: string, content: Buffer, mimeType: string) {
    return this.primary.save(name, content, mimeType)
  }

  async read(url: string) {
    return (await this.primary.read(url)) ?? (await this.fallback?.read(url)) ?? null
  }
}
