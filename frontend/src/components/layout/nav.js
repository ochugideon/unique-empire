import {
  CalendarClock, DatabaseBackup, FileText, LayoutDashboard, Package, Receipt, RefreshCw,
  ScrollText, Settings, ShoppingBag, Smartphone, TrendingUp, Users, Wallet,
} from "lucide-react"

const ALL = ["OWNER", "MANAGER", "ATTENDANT"]
const OM = ["OWNER", "MANAGER"]
const OWNER = ["OWNER"]

// `mobile` items sit in the bottom bar; the rest live under "More".
export const NAV = [
  { to: "/", label: "Home", icon: LayoutDashboard, roles: ALL, mobile: true, end: true },
  { to: "/sell", label: "New sale", icon: ShoppingBag, roles: ALL, mobile: true },
  { to: "/sales", label: "Sales", icon: Receipt, roles: ALL, mobile: true },
  { to: "/expenses", label: "Expenses", icon: Wallet, roles: ALL, mobile: true },
  { to: "/drafts", label: "Saved drafts", icon: FileText, roles: ALL },
  { to: "/products", label: "Products", icon: Package, roles: OM },
  { to: "/days", label: "Business days", icon: CalendarClock, roles: OM },
  { to: "/sync-review", label: "Sync review", icon: RefreshCw, roles: OM },
  { to: "/reports", label: "Reports", icon: TrendingUp, roles: ALL },
  { to: "/staff", label: "Staff", icon: Users, roles: OWNER },
  { to: "/devices", label: "Devices", icon: Smartphone, roles: OWNER },
  { to: "/activity", label: "Activity log", icon: ScrollText, roles: OWNER },
  { to: "/restoration", label: "Restoration", icon: DatabaseBackup, roles: OWNER },
  { to: "/settings", label: "Settings", icon: Settings, roles: ALL },
]
