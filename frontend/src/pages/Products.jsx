import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Package, Plus, Trash2 } from "lucide-react"
import { api } from "@/api/client"
import { useAction, useOnline } from "@/api/hooks"
import { Badge, Banner, Button, Card, Checkbox, Empty, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from "@/components/kit"
import { decimalToKobo, formatNaira, koboToDecimal, money, parseKobo } from "@/lib/money"

const REFRESH = ["products", "catalogue"]

export default function Products() {
  const online = useOnline()
  const [modal, setModal] = useState(null) // {type, ...}
  const cats = useQuery({ queryKey: ["products", "cats"], queryFn: () => api("/categories?include_inactive=true"), enabled: online })
  const prods = useQuery({ queryKey: ["products", "all"], queryFn: () => api("/products?include_inactive=true"), enabled: online })
  const toggleProduct = useAction((p) => api(`/products/${p.id}`, { method: "PATCH", body: { is_active: !p.is_active } }), { success: "Product updated", invalidate: REFRESH })

  if (!online) return <Banner tone="warn" title="Products need a connection">Reconnect to manage the menu. Selling still works offline with the last saved menu.</Banner>
  if (cats.isPending || prods.isPending) return <Skeleton className="h-64" />
  const error = cats.error || prods.error
  if (error) return <Banner tone="bad" title="Can't load products">{error.message}</Banner>

  return (
    <div>
      <PageHeader title="Products" description="Prices changed here apply to new sales only. Past sales keep the price they were sold at."
        actions={<><Button variant="outline" onClick={() => setModal({ type: "category" })}>Add category</Button><Button onClick={() => setModal({ type: "product" })} disabled={cats.data.length === 0}><Plus className="size-4" /> Add product</Button></>} />
      {prods.data.length === 0 ? (
        <Card><Empty icon={Package} title="No products yet" action={<Button onClick={() => setModal({ type: cats.data.length ? "product" : "category" })}>{cats.data.length ? "Add the first product" : "Add a category first"}</Button>}>Add categories like Shawarma or Milkshakes, then the products and sizes you sell.</Empty></Card>
      ) : (
        <div className="space-y-6">
          {cats.data.map((c) => {
            const list = prods.data.filter((p) => p.category_id === c.id)
            return (
              <section key={c.id}>
                <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">{c.name}{!c.is_active && <Badge>Hidden</Badge>}</h2>
                {list.length === 0 ? <p className="text-sm text-ink-soft">No products in this category.</p> : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {list.map((p) => (
                      <Card key={p.id} className={`p-4 ${p.is_active ? "" : "opacity-70"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-display text-base font-semibold">{p.name}</p>
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="ghost" onClick={() => setModal({ type: "variant", product: p })}>Add size</Button>
                            <Button size="sm" variant="ghost" loading={toggleProduct.isPending && toggleProduct.variables?.id === p.id} onClick={() => toggleProduct.mutate(p)}>{p.is_active ? "Deactivate" : "Activate"}</Button>
                          </div>
                        </div>
                        <ul className="mt-2 divide-y divide-line">
                          {p.variants.map((v) => (
                            <li key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                              <span className={`text-sm ${v.is_active ? "" : "text-ink-soft line-through"}`}>{v.name}</span>
                              <span className="flex items-center gap-3"><span className="num font-semibold">{money(v.price)}</span><Button size="sm" variant="outline" onClick={() => setModal({ type: "variant", product: p, variant: v })}>Edit</Button></span>
                            </li>
                          ))}
                        </ul>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
      <CategoryModal open={modal?.type === "category"} onClose={() => setModal(null)} />
      <ProductModal open={modal?.type === "product"} onClose={() => setModal(null)} categories={cats.data.filter((c) => c.is_active)} />
      <VariantModal open={modal?.type === "variant"} onClose={() => setModal(null)} product={modal?.product} variant={modal?.variant} />
    </div>
  )
}

function CategoryModal({ open, onClose }) {
  const [name, setName] = useState("")
  const save = useAction(() => api("/categories", { method: "POST", body: { name: name.trim() } }), { success: "Category added", invalidate: REFRESH, onDone: () => { setName(""); onClose() } })
  return (
    <Modal open={open} onClose={onClose} title="Add category" size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>Add category</Button></>}>
      <Field label="Name" htmlFor="cn"><Input id="cn" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Smoothies" /></Field>
    </Modal>
  )
}

function ProductModal({ open, onClose, categories }) {
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [description, setDescription] = useState("")
  const [variants, setVariants] = useState([{ name: "Regular", price: "" }])
  const valid = name.trim().length >= 2 && (category || categories[0]) && variants.length > 0 && variants.every((v) => v.name.trim() && parseKobo(v.price) !== null)
  const save = useAction(() => api("/products", { method: "POST", body: {
    name: name.trim(), category_id: category || categories[0].id, description: description.trim() || null,
    variants: variants.map((v) => ({ name: v.name.trim(), price: koboToDecimal(parseKobo(v.price)) })),
  } }), { success: "Product added", invalidate: REFRESH, onDone: () => { setName(""); setDescription(""); setVariants([{ name: "Regular", price: "" }]); onClose() } })
  const setV = (i, key, val) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, [key]: val } : v)))
  return (
    <Modal open={open} onClose={onClose} title="Add product" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>Add product</Button></>}>
      <div className="space-y-4">
        <Field label="Name" htmlFor="pn"><Input id="pn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Chicken shawarma" /></Field>
        <Field label="Category" htmlFor="pc"><Select id="pc" value={category || categories[0]?.id || ""} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Description (optional)" htmlFor="pd"><Textarea id="pd" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div>
          <p className="mb-2 text-sm font-medium">Sizes and prices</p>
          <div className="space-y-2">
            {variants.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input aria-label="Size name" value={v.name} onChange={(e) => setV(i, "name", e.target.value)} placeholder="Size" />
                <Input aria-label="Price" inputMode="decimal" value={v.price} onChange={(e) => setV(i, "price", e.target.value)} placeholder="₦ price" className="num" invalid={v.price !== "" && parseKobo(v.price) === null} />
                <Button size="icon" variant="ghost" aria-label="Remove size" disabled={variants.length === 1} onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setVariants((vs) => [...vs, { name: "", price: "" }])}><Plus className="size-4" /> Add another size</Button>
        </div>
      </div>
    </Modal>
  )
}

function VariantModal({ open, onClose, product, variant }) {
  const editing = !!variant
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [active, setActive] = useState(true)
  const [seed, setSeed] = useState(null)
  if (open && seed !== (variant?.id ?? product?.id)) { // reset the form each time it opens for a different item
    setSeed(variant?.id ?? product?.id)
    setName(variant?.name ?? ""); setPrice(variant ? koboToDecimal(decimalToKobo(variant.price)) : ""); setActive(variant?.is_active ?? true)
  }
  const ok = name.trim() && parseKobo(price) !== null
  const save = useAction(() => editing
    ? api(`/variants/${variant.id}`, { method: "PATCH", body: { name: name.trim(), price: koboToDecimal(parseKobo(price)), is_active: active } })
    : api(`/products/${product.id}/variants`, { method: "POST", body: { name: name.trim(), price: koboToDecimal(parseKobo(price)) } }),
    { success: "Saved", invalidate: REFRESH, onDone: () => { setSeed(null); onClose() } })
  return (
    <Modal open={open} onClose={() => { setSeed(null); onClose() }} title={editing ? `Edit ${variant.name}` : "Add a size"} description={product?.name} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!ok} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Size name" htmlFor="vn"><Input id="vn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Price (₦)" htmlFor="vp" hint={editing ? "Applies to new sales. Past sales keep their price." : undefined}><Input id="vp" inputMode="decimal" className="num" value={price} onChange={(e) => setPrice(e.target.value)} invalid={price !== "" && parseKobo(price) === null} /></Field>
        {editing && <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} label="Available for sale" />}
        {editing && variant && decimalToKobo(variant.price) !== parseKobo(price) && parseKobo(price) !== null && <Banner tone="warn">Price change: {formatNaira(decimalToKobo(variant.price))} to {formatNaira(parseKobo(price))}. This is recorded in the audit log.</Banner>}
      </div>
    </Modal>
  )
}
