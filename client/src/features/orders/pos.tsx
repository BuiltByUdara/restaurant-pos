import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAllRecords, money } from '../configuration/api';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/store';
type Product = {
  id: string;
  name: string;
  priceMinor: number;
  available: boolean;
  modifierGroupIds: string[];
  categoryId: string;
  imageUrl: string;
};
type Group = {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  options: { id: string; name: string; priceMinor: number }[];
};
type Line = { menuItemId: string; quantity: number; optionIds: string[]; notes: string };
type Order = {
  _id: string;
  version: number;
  status: string;
  subtotalMinor: number;
  tableId: string | null;
  customerName: string;
  lines: (Line & {
    name: string;
    unitPriceMinor: number;
    modifiers: { optionId: string; name: string; priceMinor: number }[];
  })[];
  history: { status?: string; action?: string; at: string }[];
};
export function Pos() {
  const products = useAllRecords<Product>('menu-items'),
    groups = useAllRecords<Group>('modifier-groups');
  const categories = useAllRecords<{ id: string; name: string }>('categories');
  const [category, setCategory] = useState('');
  const tables = useAllRecords<{ id: string; name: string; status: string }>('tables');
  const [page, setPage] = useState(1);
  const orders = useQuery({
    queryKey: ['orders', page],
    queryFn: () => api<{ items: Order[]; pagination: { total: number } }>(`/orders?page=${page}`),
    refetchInterval: 5000,
  });
  const [editing, setEditing] = useState<Order | null>(null),
    [detail, setDetail] = useState<Order | null>(null),
    [tableId, setTableId] = useState(''),
    [customerName, setCustomerName] = useState('');
  const approve = useAuth((s) => s.user?.permissions.includes('orders:approve'));
  function reset() {
    setCart([]);
    setEditing(null);
    setTableId('');
    setCustomerName('');
  }
  const [cart, setCart] = useState<Line[]>([]),
    [search, setSearch] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const estimate = cart.reduce(
    (sum, line) =>
      sum +
      line.quantity *
        ((products.data?.find((p) => p.id === line.menuItemId)?.priceMinor || 0) +
          (groups.data || [])
            .flatMap((g) => g.options)
            .filter((o) => line.optionIds.includes(o.id))
            .reduce((s, o) => s + o.priceMinor, 0)),
    0,
  );
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await orders.refetch();
      await tables.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(index: number, patch: Partial<Line>) {
    setCart(cart.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }
  return (
    <div className="space-y-6">
      <h1 className="text-3xl">Point of sale</h1>
      <Link to="/menu" className="underline">
        Manage menu
      </Link>
      {(error || products.error || groups.error || orders.error) && (
        <p role="alert">{error || 'Could not load restaurant data. Please retry.'}</p>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-4">
          <input
            aria-label="Search products"
            className="w-full rounded border bg-background p-3"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products"
          />
          <select
            aria-label="Menu category"
            className="border bg-background p-3"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {products.isLoading && <p role="status">Loading menu…</p>}
          <div className="grid grid-cols-2 gap-3">
            {products.data
              ?.filter(
                (p) =>
                  p.name.toLowerCase().includes(search.toLowerCase()) &&
                  (!category || p.categoryId === category),
              )
              .map((p) => (
                <Button
                  key={p.id}
                  disabled={!p.available || busy}
                  className="h-auto min-h-24 whitespace-normal"
                  onClick={() =>
                    setCart([...cart, { menuItemId: p.id, quantity: 1, optionIds: [], notes: '' }])
                  }
                >
                  {p.imageUrl && (
                    <img src={p.imageUrl} alt="" className="h-12 w-12 rounded object-cover" />
                  )}
                  {p.name}
                  <br />
                  {money(p.priceMinor)}
                  {!p.available && ' · Unavailable'}
                </Button>
              ))}
          </div>
          {products.data?.length === 0 && <p>No menu items yet.</p>}
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="text-xl">Current order</h2>
          {!cart.length && <p>Select menu items to begin.</p>}
          <p>{editing ? `Editing #${editing._id.slice(-8)}` : 'New order'}</p>
          <label className="block">
            Customer name
            <input
              className="w-full border bg-background p-2"
              maxLength={120}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </label>
          <label className="block">
            Table
            <select
              className="w-full border bg-background p-2"
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
            >
              <option value="">Takeaway</option>
              {tables.data
                ?.filter((t) => t.status !== 'OCCUPIED' || t.id === editing?.tableId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          {cart.map((line, index) => {
            const product = products.data?.find((p) => p.id === line.menuItemId);
            return (
              <fieldset disabled={busy} key={index} className="space-y-3 border-b pb-4">
                <legend>{product?.name}</legend>
                <label className="block">
                  Quantity{' '}
                  <input
                    className="w-20 rounded border bg-background p-2"
                    type="number"
                    min="1"
                    max="99"
                    value={line.quantity}
                    onChange={(e) => edit(index, { quantity: Number(e.target.value) })}
                  />
                </label>
                {groups.data
                  ?.filter((g) => product?.modifierGroupIds.includes(g.id))
                  .map((g) => (
                    <div key={g.id}>
                      <p>
                        {g.name} · Choose {g.minSelections}–{g.maxSelections}
                      </p>
                      {g.options.map((o) => (
                        <label className="block p-2" key={o.id}>
                          <input
                            type="checkbox"
                            checked={line.optionIds.includes(o.id)}
                            onChange={(e) =>
                              edit(index, {
                                optionIds: e.target.checked
                                  ? [...line.optionIds, o.id]
                                  : line.optionIds.filter((id) => id !== o.id),
                              })
                            }
                          />{' '}
                          {o.name} · {money(o.priceMinor)}
                        </label>
                      ))}
                    </div>
                  ))}
                <label className="block">
                  Preparation notes
                  <input
                    maxLength={500}
                    className="w-full rounded border bg-background p-2"
                    value={line.notes}
                    onChange={(e) => edit(index, { notes: e.target.value })}
                  />
                </label>
                <Button
                  variant="outline"
                  onClick={() => setCart(cart.filter((_, i) => i !== index))}
                >
                  Remove item
                </Button>
              </fieldset>
            );
          })}
          <p className="text-sm text-muted-foreground">
            Estimated subtotal: {money(estimate)}. The server confirms prices when saving. Payments
            and kitchen tickets arrive in later phases.
          </p>
          <Button
            disabled={busy || !cart.length || groups.isLoading}
            onClick={() =>
              void run(async () => {
                const saved = await api<Order>(editing ? `/orders/${editing._id}` : '/orders', {
                  method: editing ? 'PUT' : 'POST',
                  body: JSON.stringify({
                    lines: cart,
                    tableId: tableId || null,
                    customerName,
                    ...(editing ? { version: editing.version } : {}),
                  }),
                });
                reset();
                setDetail(saved);
              })
            }
          >
            {busy ? 'Saving…' : 'Save order'}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (!cart.length || window.confirm('Discard unsaved cart changes?')) reset();
            }}
          >
            New order
          </Button>
        </section>
      </div>
      <section className="space-y-3">
        <h2 className="text-xl">Order history</h2>
        {orders.isLoading && <p>Loading orders…</p>}
        {orders.data?.items.length === 0 && <p>No orders yet.</p>}
        {orders.data?.items.map((order) => (
          <div
            key={order._id}
            className="flex flex-wrap items-center gap-4 rounded border bg-card p-4"
          >
            <span>
              #{order._id.slice(-8)} · {order.status}
            </span>
            <strong>{money(order.subtotalMinor)}</strong>
            <Button variant="outline" onClick={() => setDetail(order)}>
              Details
            </Button>
            {order.status === 'OPEN' && (
              <Button
                disabled={busy}
                onClick={() => {
                  if (cart.length && !window.confirm('Discard unsaved cart changes?')) return;
                  setEditing(order);
                  setCustomerName(order.customerName || '');
                  setTableId(order.tableId || '');
                  setCart(
                    order.lines.map((l) => ({
                      menuItemId: l.menuItemId,
                      quantity: l.quantity,
                      notes: l.notes,
                      optionIds: l.modifiers.map((m) => m.optionId),
                    })),
                  );
                }}
              >
                Edit order
              </Button>
            )}
            {(['COMPLETED', 'CANCELLED', 'VOIDED'].includes(order.status)
              ? []
              : [
                  ...(order.status === 'OPEN'
                    ? ['SUBMITTED', 'CANCELLED']
                    : order.status === 'SUBMITTED'
                      ? ['PREPARING']
                      : order.status === 'PREPARING'
                        ? ['READY']
                        : order.status === 'READY'
                          ? ['SERVED']
                          : []),
                  ...(approve && order.status !== 'OPEN' ? ['VOIDED'] : []),
                ]
            ).map((status) => (
              <Button
                disabled={busy}
                key={status}
                variant="outline"
                onClick={() => {
                  if (
                    ['VOIDED', 'CANCELLED'].includes(status) &&
                    !window.confirm('Confirm closing this order?')
                  )
                    return;
                  void run(async () => {
                    setDetail(
                      await api<Order>(`/orders/${order._id}/status`, {
                        method: 'PATCH',
                        body: JSON.stringify({ version: order.version, status }),
                      }),
                    );
                  });
                }}
              >
                {status === 'SUBMITTED'
                  ? 'Submit order'
                  : status === 'CANCELLED'
                    ? 'Cancel order'
                    : status}
              </Button>
            ))}
            {!['COMPLETED', 'CANCELLED', 'VOIDED'].includes(order.status) && (
              <select
                aria-label={`Transfer order ${order._id.slice(-8)}`}
                disabled={busy}
                className="border bg-background p-2"
                value={order.tableId || ''}
                onChange={(e) =>
                  void run(async () => {
                    setDetail(
                      await api<Order>(`/orders/${order._id}/table`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          version: order.version,
                          tableId: e.target.value || null,
                        }),
                      }),
                    );
                  })
                }
              >
                <option value="">Takeaway</option>
                {tables.data
                  ?.filter((t) => t.status !== 'OCCUPIED' || t.id === order.tableId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        ))}
      </section>
      <div className="flex gap-4">
        <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous orders
        </Button>
        <span>Page {page}</span>
        <Button
          disabled={page * 30 >= (orders.data?.pagination.total || 0)}
          onClick={() => setPage(page + 1)}
        >
          Next orders
        </Button>
      </div>
      {detail && (
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-xl">Order details #{detail._id.slice(-8)}</h2>
          <p>
            {detail.customerName || 'Walk-in'} · {detail.status} · {money(detail.subtotalMinor)}
          </p>
          {detail.lines.map((l, i) => (
            <p key={i}>
              {l.quantity} × {l.name} · {money(l.unitPriceMinor)}{' '}
              {l.modifiers.map((m) => `${m.name} (${money(m.priceMinor)})`).join(', ')}{' '}
              {l.notes && `— ${l.notes}`}
            </p>
          ))}
          <h3>History</h3>
          {detail.history?.map((h, i) => (
            <p key={i}>
              {h.action || h.status} · {new Date(h.at).toLocaleString()}
            </p>
          ))}
          <Button variant="outline" onClick={() => setDetail(null)}>
            Close details
          </Button>
        </section>
      )}
    </div>
  );
}
