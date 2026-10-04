import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from './client'

const Ctx = createContext<ApiClient | null>(null)

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  const qc = useQueryClient()
  useEffect(
    () =>
      client.subscribe((e) => {
        qc.invalidateQueries({ queryKey: ['cases'] })
        qc.invalidateQueries({ queryKey: ['analytics'] })
        if (e.type === 'case_changed') qc.invalidateQueries({ queryKey: ['case', e.id] })
        else qc.invalidateQueries({ queryKey: ['case'] })
        qc.invalidateQueries({ queryKey: ['status'] })
        qc.invalidateQueries({ queryKey: ['settings'] })
      }),
    [client, qc],
  )
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>
}

export function useApi(): ApiClient {
  const c = useContext(Ctx)
  if (!c) throw new Error('ApiProvider missing')
  return c
}
