import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { useAuth } from "@/auth/AuthContext"
import { Spinner } from "@/components/kit"
import AppShell from "@/components/layout/AppShell"
import DeviceGate from "@/components/layout/DeviceGate"
import { NAV } from "@/components/layout/nav"
import Login from "@/pages/Login"

const pages = {
  "/": lazy(() => import("@/pages/Dashboard")),
  "/sell": lazy(() => import("@/pages/NewSale")),
  "/sales": lazy(() => import("@/pages/SalesHistory")),
  "/expenses": lazy(() => import("@/pages/Expenses")),
  "/drafts": lazy(() => import("@/pages/Drafts")),
  "/products": lazy(() => import("@/pages/Products")),
  "/days": lazy(() => import("@/pages/BusinessDays")),
  "/sync-review": lazy(() => import("@/pages/SyncReview")),
  "/reports": lazy(() => import("@/pages/Reports")),
  "/staff": lazy(() => import("@/pages/Staff")),
  "/devices": lazy(() => import("@/pages/Devices")),
  "/activity": lazy(() => import("@/pages/Activity")),
  "/restoration": lazy(() => import("@/pages/Restoration")),
  "/settings": lazy(() => import("@/pages/Settings")),
}

const Loading = () => <div className="grid h-60 place-items-center"><Spinner className="size-7" /></div>

function Protected({ children }) {
  const { status } = useAuth()
  if (status === "loading") return <div className="grid min-h-dvh place-items-center"><Spinner className="size-8" /></div>
  return status === "authed" ? children : <Navigate to="/login" replace />
}

// The menu hides what a role can't use, and the server still checks every request.
function RoleRoute({ roles, children }) {
  const { user } = useAuth()
  return roles.includes(user.role) ? children : <Navigate to="/" replace />
}

export default function App() {
  const { status } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={status === "authed" ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<Protected><DeviceGate><AppShell /></DeviceGate></Protected>}>
        {NAV.map(({ to, roles }) => {
          const Page = pages[to]
          return (
            <Route key={to} path={to} element={<RoleRoute roles={roles}><Suspense fallback={<Loading />}><Page /></Suspense></RoleRoute>} />
          )
        })}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
