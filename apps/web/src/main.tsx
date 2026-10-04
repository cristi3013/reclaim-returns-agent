import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import './index.css'
import { ApiProvider, createApiClient } from '@/api'
import { router } from '@/app/router'
import { TooltipProvider } from '@/components/ui/tooltip'

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 2000, retry: 1 } } })
const client = createApiClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ApiProvider client={client}>
        <TooltipProvider delayDuration={200}>
          <RouterProvider router={router} />
        </TooltipProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
)
