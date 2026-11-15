import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { registerSW } from "virtual:pwa-register"
import "@fontsource-variable/figtree"
import "@fontsource-variable/bricolage-grotesque"
import "./index.css"
import App from "./App.jsx"
import { AuthProvider } from "@/auth/AuthContext"
import { SyncProvider } from "@/offline/SyncProvider"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: (count, err) => err?.status >= 500 && count < 1, refetchOnWindowFocus: true },
  },
})

if (import.meta.env.PROD) registerSW({ immediate: true })

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <SyncProvider>
            <App />
            <Toaster position="top-center" richColors closeButton />
          </SyncProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)
