import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Eye, EyeOff, Info } from "lucide-react"
import { useAuth } from "@/auth/AuthContext"
import { Banner, Button, Field, Input } from "@/components/kit"

const schema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
})

// A kitchen docket: the vernacular of this business, used once on the sign-in screen.
function Docket() {
  const lines = [["Chicken shawarma, large", "2", "₦9,000.00"], ["Strawberry milkshake", "1", "₦2,500.00"], ["Popcorn, salted", "3", "₦3,000.00"]]
  return (
    <div className="w-full max-w-sm rotate-[-2deg] rounded-2xl bg-surface p-6 text-ink shadow-2xl">
      <p className="font-display text-lg font-semibold">Order UE-A1-261113-014</p>
      <p className="text-sm text-ink-soft">Counter phone</p>
      <div className="tear my-4" />
      <ul className="space-y-2 text-sm">
        {lines.map(([name, qty, price]) => (
          <li key={name} className="flex justify-between gap-3"><span>{qty} × {name}</span><span className="num">{price}</span></li>
        ))}
      </ul>
      <div className="tear my-4" />
      <div className="flex items-baseline justify-between"><span className="text-sm">Paid: cash and POS</span><span className="num font-display text-2xl font-semibold">₦14,500.00</span></div>
    </div>
  )
}

export default function Login() {
  const { login, notice } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [show, setShow] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) })

  const onSubmit = async (v) => {
    setError("")
    try {
      await login(v.username, v.password)
      navigate("/", { replace: true })
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-brand p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-butter font-display font-bold text-butter-ink">UE</div>
          <span className="font-display text-xl font-semibold">Unique Empire</span>
        </div>
        <div className="grid place-items-center"><Docket /></div>
        <p className="max-w-sm font-display text-3xl font-semibold leading-tight">Every sale written down once, and counted right.</p>
      </section>

      <section className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand font-display text-lg font-bold text-white">UE</div>
          </div>
          <h1 className="font-display text-3xl font-semibold">Welcome back</h1>
          <p className="mt-1.5 text-ink-soft">Sign in to record sales and run the day.</p>

          {notice && <Banner tone="warn" icon={Info} className="mt-6">{notice}</Banner>}

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5" noValidate>
            <Field label="Username" htmlFor="username" error={errors.username?.message}>
              <Input id="username" autoComplete="username" autoCapitalize="none" spellCheck={false} className="h-12" invalid={!!errors.username} {...register("username")} />
            </Field>
            <Field label="Password" htmlFor="password" error={errors.password?.message}>
              <div className="relative">
                <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" className="h-12 pr-12" invalid={!!errors.password} {...register("password")} />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-1.5 top-1.5 grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-ink/5">
                  {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
            </Field>
            {error && <Banner tone="bad">{error}</Banner>}
            <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Sign in</Button>
          </form>
          <p className="mt-8 text-xs text-ink-soft">Sign in online once on each device. After that you can keep selling offline for up to 7 days.</p>
        </div>
      </section>
    </div>
  )
}
