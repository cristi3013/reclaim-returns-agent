import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import './index.css'
import { ApiProvider, createApiClient } from '@/api'
import { AuthProvider, supabaseAuth } from '@/auth'
import { router } from '@/app/router'
import { TooltipProvider } from '@/components/ui/tooltip'

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 2000, retry: 1 } } })
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
if (!supabaseUrl || !supabaseKey) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required: they are where people sign in.')
const auth = supabaseAuth(supabaseUrl, supabaseKey)
const client = createApiClient(auth.getToken)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider client={auth}>
        <ApiProvider client={client}>
          <TooltipProvider delayDuration={200}>
            <RouterProvider router={router} />
          </TooltipProvider>
          <Toaster position="bottom-right" richColors closeButton />
        </ApiProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
