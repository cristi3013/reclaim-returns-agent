import { HttpApiClient } from './http/HttpApiClient'
import { MockApiClient } from './mock/MockApiClient'
import type { ApiClient } from './client'

export function createApiClient(): ApiClient {
  return import.meta.env.VITE_API_MODE === 'http'
    ? new HttpApiClient(import.meta.env.VITE_API_BASE ?? '')
    : new MockApiClient()
}

export * from './client'
export * from './context'
export * from './hooks'
