import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { LogOut, MoreHorizontal, WifiOff } from "lucide-react"
import { useAuth } from "@/auth/AuthContext"
import { useSync } from "@/offline/SyncProvider"
import { Banner, Modal } from "@/components/kit"
import { NAV } from "@/components/layout/nav"
import SyncPill from "@/components/layout/SyncPill"
import { cn } from "@/lib/utils"

const Brand = () => (
  <div className="flex items-center gap-3">
    <div className="grid size-10 place-items-center rounded-xl bg-brand font-display text-base font-bold text-white">UE</div>
    <div className="leading-tight">
      <p className="font-display text-lg font-semibold">Unique Empire</p>
      <p className="text-xs text-ink-soft">Sales and business</p>
    </div>
  </div>
)

export default function AppShell() {
  const { user, logout, offline: offlineAuth } = useAuth()
  const { online } = useSync()
  const [more, setMore] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => setMore(false), [pathname])

  const items = NAV.filter((n) => n.roles.includes(user.role))
  const bottom = items.filter((n) => n.mobile)
  const rest = items.filter((n) => !n.mobile)

  const desktopLink = ({ isActive }) =>
    cn("flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors", isActive ? "bg-brand text-white" : "text-ink hover:bg-ink/5")

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface p-4 lg:flex">
        <Brand />
        <nav className="mt-6 flex-1 space-y-1 overflow-y-auto" aria-label="Main">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={desktopLink}>
              <Icon className="size-5" aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <SyncPill />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.full_name}</p>
              <p className="text-xs text-ink-soft">{user.role.charAt(0) + user.role.slice(1).toLowerCase()}</p>
            </div>
            <button onClick={() => logout()} aria-label="Sign out" className="grid size-10 place-items-center rounded-xl hover:bg-ink/5"><LogOut className="size-5" /></button>
          </div>
        </div>
      </aside>

      <header className="pt-safe sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <Brand />
        <SyncPill />
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-5 pb-28 lg:px-8 lg:py-8">
        {!online && (
          <Banner tone="warn" icon={WifiOff} title="You are working offline" className="mb-4">
            Sales and expenses are saved on this device and upload by themselves when the connection returns.
            {offlineAuth && " Offline access lasts up to 7 days after your last online sign-in."}
          </Banner>
        )}
        <Outlet />
      </main>

      <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface lg:hidden">
        {bottom.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium", isActive ? "text-brand" : "text-ink-soft")}>
            {({ isActive }) => (<>
              <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", isActive && "bg-brand-soft")}><Icon className="size-5" aria-hidden /></span>
              {label}
            </>)}
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-ink-soft">
          <span className="grid h-7 w-12 place-items-center"><MoreHorizontal className="size-5" aria-hidden /></span>
          More
        </button>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title={user.full_name} description={`Signed in as ${user.role.toLowerCase()}`}
        footer={<button onClick={() => logout()} className="inline-flex h-11 items-center gap-2 rounded-xl px-4 font-semibold text-bad hover:bg-bad-soft"><LogOut className="size-5" /> Sign out</button>}>
        <div className="grid grid-cols-2 gap-2">
          {rest.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className="flex min-h-14 items-center gap-3 rounded-xl border border-line px-3.5 text-sm font-semibold hover:bg-ground">
              <Icon className="size-5 shrink-0 text-brand" aria-hidden /> {label}
            </NavLink>
          ))}
        </div>
      </Modal>
    </div>
  )
}
