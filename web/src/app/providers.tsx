'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { AuthProvider } from '@/lib/auth-context'
import { TracksProvider } from '@/lib/tracks-context'
import { WorkspaceProvider } from '@/lib/workspace-context'

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WorkspaceProvider>
          <TracksProvider>{children}</TracksProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
