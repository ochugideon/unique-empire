import { forwardRef, useEffect, useRef } from "react"
import { Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatNaira } from "@/lib/money"

/* ---------- Buttons ---------- */
const VARIANT = {
  primary: "bg-brand text-white hover:bg-brand-strong",
  secondary: "bg-brand-soft text-brand-strong hover:bg-[#cde5dd]",
  outline: "border border-line bg-surface text-ink hover:bg-ground",
  ghost: "text-ink hover:bg-ink/5",
  danger: "bg-bad text-white hover:bg-[#8f1e17]",
  butter: "bg-butter text-butter-ink hover:bg-[#e6a81e]",
}
const SIZE = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-[15px]", lg: "h-14 px-6 text-base", icon: "size-11", "icon-sm": "size-9" }

export const Button = forwardRef(function Button({ variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn("inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition-colors active:translate-y-px disabled:pointer-events-none disabled:opacity-50", VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

/* ---------- Form controls ---------- */
const control = "w-full rounded-xl border bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-soft/60 disabled:bg-ground disabled:text-ink-soft"
export const Input = forwardRef(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cn(control, "h-11", invalid ? "border-bad" : "border-line", className)} {...rest} />
})
export const Textarea = forwardRef(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} rows={3} className={cn(control, "py-2.5", invalid ? "border-bad" : "border-line", className)} {...rest} />
})
export const Select = forwardRef(function Select({ className, invalid, children, ...rest }, ref) {
  return <select ref={ref} className={cn(control, "h-11", invalid ? "border-bad" : "border-line", className)} {...rest}>{children}</select>
})

export function Field({ label, error, hint, htmlFor, children, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">{label}</label>}
      {children}
      {hint && !error && <p className="text-xs text-ink-soft">{hint}</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  )
}

export function Checkbox({ label, ...rest }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[#0b5d4b]" {...rest} />
      <span>{label}</span>
    </label>
  )
}

/* ---------- Surfaces ---------- */
export const Card = ({ className, ...rest }) => <div className={cn("rounded-2xl border border-line bg-surface", className)} {...rest} />

const TONE = {
  neutral: "bg-ink/[0.07] text-ink",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  brand: "bg-brand-soft text-brand-strong",
  butter: "bg-butter-soft text-butter-ink",
}
export const Badge = ({ tone = "neutral", className, ...rest }) => (
  <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", TONE[tone], className)} {...rest} />
)

export function Banner({ tone = "neutral", icon: Icon, title, children, action, className }) {
  const style = { neutral: "border-line bg-surface", warn: "border-butter/60 bg-butter-soft", bad: "border-bad/30 bg-bad-soft", ok: "border-ok/30 bg-ok-soft", brand: "border-brand/20 bg-brand-soft" }[tone]
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm", style, className)}>
      {Icon && <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-ink-soft" : ""}>{children}</div>}
      </div>
      {action}
    </div>
  )
}

export const Skeleton = ({ className }) => <div className={cn("animate-pulse rounded-lg bg-ink/10", className)} aria-hidden />
export const Spinner = ({ className }) => <Loader2 className={cn("size-5 animate-spin text-ink-soft", className)} aria-label="Loading" />

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon className="size-7" aria-hidden /></div>}
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-xl text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Segmented({ value, onChange, options, className }) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-xl bg-ink/[0.07] p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-9 rounded-lg px-3.5 text-sm font-semibold transition-colors", value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const Naira = ({ kobo, className, ...rest }) => <span className={cn("num", className)} {...rest}>{formatNaira(kobo)}</span>

/* ---------- Dialog (native <dialog>: focus trap, Esc to close, backdrop) ---------- */
export function Modal({ open, onClose, title, description, children, footer, size = "md" }) {
  const ref = useRef(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  const width = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl" }[size]
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
      className={cn("m-auto w-[calc(100%-1.5rem)] rounded-2xl bg-surface p-0 shadow-2xl max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none", width)}
    >
      {open && (
        <div className="flex max-h-[88dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="-mr-2 grid size-9 shrink-0 place-items-center rounded-lg hover:bg-ink/5"><X className="size-5" /></button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-safe">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function ConfirmModal({ open, onClose, title, children, confirmLabel = "Confirm", danger, loading, onConfirm }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </>}
    >
      <div className="text-sm text-ink-soft">{children}</div>
    </Modal>
  )
}

/* ---------- Table helpers ---------- */
export const TableWrap = ({ children }) => <div className="overflow-x-auto rounded-2xl border border-line bg-surface"><table className="w-full min-w-max text-sm">{children}</table></div>
export const Th = ({ className, ...rest }) => <th className={cn("whitespace-nowrap border-b border-line bg-ground/60 px-4 py-2.5 text-left text-xs font-semibold text-ink-soft", className)} {...rest} />
export const Td = ({ className, ...rest }) => <td className={cn("whitespace-nowrap border-b border-line px-4 py-3 last:border-b-0", className)} {...rest} />

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink-soft">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  )
}
