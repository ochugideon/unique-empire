import { decimalToKobo, formatNaira } from "@/lib/money";

// Items sold in one business day: per product, how many were sold and what they came to.
// Voided sales are already excluded by the server.
export default function ProductBreakdown({ products }) {
  const groups = new Map();
  for (const p of products || []) {
    const g = groups.get(p.product) ?? {
      name: p.product,
      qty: 0,
      kobo: 0,
      variants: [],
    };
    g.qty += p.quantity;
    g.kobo += decimalToKobo(p.amount);
    g.variants.push(p);
    groups.set(p.product, g);
  }
  const list = [...groups.values()].sort((a, b) => b.kobo - a.kobo);
  if (list.length === 0)
    return <p className="py-4 text-sm text-ink-soft">No items sold yet.</p>;

  const totalQty = list.reduce((s, g) => s + g.qty, 0);
  const totalKobo = list.reduce((s, g) => s + g.kobo, 0);
  const top = list[0].kobo || 1;

  return (
    <div>
      <ul className="divide-y divide-line">
        {list.map((g) => (
          <li key={g.name} className="py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium">{g.name}</p>
              <p className="num font-semibold">{formatNaira(g.kobo)}</p>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-3 text-sm text-ink-soft">
              <span className="num">{g.qty} sold</span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10"
              aria-hidden
            >
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.max(4, (g.kobo / top) * 100)}%` }}
              />
            </div>
            {g.variants.length > 1 && (
              <ul className="mt-2 space-y-0.5 text-sm text-ink-soft">
                {g.variants.map((v) => (
                  <li key={v.variant} className="flex justify-between gap-3">
                    <span>
                      {v.variant}: <span className="num">{v.quantity}</span>
                    </span>
                    <span className="num">
                      {formatNaira(decimalToKobo(v.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-baseline justify-between border-t-2 border-line pt-3">
        <span className="font-semibold">
          All items{" "}
          <span className="num font-normal text-ink-soft">({totalQty})</span>
        </span>
        <span className="num font-display text-xl font-semibold">
          {formatNaira(totalKobo)}
        </span>
      </div>
    </div>
  );
}
