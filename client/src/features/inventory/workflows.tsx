import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAllRecords } from '../configuration/api';
import { useAuth } from '../auth/store';
import { Button } from '../../components/ui/button';
type Part = { ingredientId: string; quantity: number };
type Ingredient = { _id: string; name: string; unit: string };
type Supplier = { _id: string; name: string; contact: string };
type Recipe = { _id: string; menuItemId: string; version: number; components: Part[] };
type Purchase = { _id: string; supplierId: string; status: string; version: number; lines: Part[] };
async function all<T>(resource: string) {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await api<{ items: T[]; pagination: { total: number } }>(
      `/inventory/${resource}?page=${page}`,
    );
    items.push(...result.items);
    if (!result.items.length || items.length >= result.pagination.total) return items;
  }
}
export function InventoryWorkflows() {
  const [recipeVersion, setRecipeVersion] = useState<number | null>(null);
  const cache = useQueryClient(),
    writable = useAuth((s) => s.user?.permissions.includes('inventory:write'));
  const ingredients = useQuery({
    queryKey: ['inventory', 'all'],
    queryFn: () => all<Ingredient>('ingredients'),
  });
  const suppliers = useQuery({
    queryKey: ['inventory', 'suppliers'],
    queryFn: () => all<Supplier>('suppliers'),
  });
  const recipes = useQuery({
    queryKey: ['inventory', 'recipes'],
    queryFn: () => all<Recipe>('recipes'),
  });
  const menu = useAllRecords<{ id: string; name: string }>('menu-items');
  const [page, setPage] = useState(1),
    [historyPage, setHistoryPage] = useState(1),
    [name, setName] = useState(''),
    [contact, setContact] = useState(''),
    [supplier, setSupplier] = useState(''),
    [product, setProduct] = useState(''),
    [parts, setParts] = useState<Part[]>([]),
    [ingredient, setIngredient] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const purchases = useQuery({
    queryKey: ['inventory', 'purchases', page],
    queryFn: () =>
      api<{ items: Purchase[]; pagination: { total: number } }>(
        `/inventory/purchases?page=${page}`,
      ),
  });
  const movements = useQuery({
    queryKey: ['inventory', 'movements', historyPage],
    queryFn: () =>
      api<{
        items: {
          _id: string;
          ingredientId: string;
          kind: string;
          delta: number;
          reason: string;
          createdAt: string;
        }[];
        pagination: { total: number };
      }>(`/inventory/movements?page=${historyPage}`),
    refetchInterval: 15000,
  });
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await cache.invalidateQueries({ queryKey: ['inventory'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const label = (id: string) => {
    const i = ingredients.data?.find((i) => i._id === id);
    return i ? `${i.name} (${i.unit})` : id;
  };
  return (
    <div className="space-y-6">
      {(error ||
        ingredients.error ||
        suppliers.error ||
        recipes.error ||
        purchases.error ||
        movements.error) && <p role="alert">{error || 'Could not load inventory workflows.'}</p>}
      <section className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-xl">Suppliers</h2>
        {suppliers.data?.map((s) => (
          <p key={s._id}>
            {s.name} · {s.contact}
          </p>
        ))}
        {writable && (
          <>
            <label>
              Supplier name <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Contact <input value={contact} onChange={(e) => setContact(e.target.value)} />
            </label>
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api('/inventory/suppliers', {
                    method: 'POST',
                    body: JSON.stringify({ name, contact }),
                  }),
                )
              }
            >
              Add supplier
            </Button>
          </>
        )}
      </section>
      {writable && (
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-xl">Recipe / purchase lines</h2>
          <label>
            Ingredient{' '}
            <select
              aria-label="Ingredient"
              value={ingredient}
              onChange={(e) => setIngredient(e.target.value)}
            >
              <option value="">Choose ingredient</option>
              {ingredients.data?.map((i) => (
                <option key={i._id} value={i._id}>
                  {label(i._id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity{' '}
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <Button
            onClick={() => {
              if (
                !ingredient ||
                !Number.isInteger(Number(quantity)) ||
                Number(quantity) <= 0 ||
                parts.some((p) => p.ingredientId === ingredient)
              ) {
                setError('Select a unique ingredient and a positive whole quantity.');
                return;
              }
              setParts([...parts, { ingredientId: ingredient, quantity: Number(quantity) }]);
            }}
          >
            Add line
          </Button>
          {parts.map((p, i) => (
            <p key={p.ingredientId}>
              {label(p.ingredientId)} × {p.quantity}{' '}
              <Button
                variant="outline"
                onClick={() => setParts(parts.filter((_, index) => index !== i))}
              >
                Remove line
              </Button>
            </p>
          ))}
          <label>
            Menu item{' '}
            <select
              aria-label="Menu item"
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                setRecipeVersion(
                  recipes.data?.find((r) => r.menuItemId === e.target.value)?.version ?? null,
                );
                setParts(
                  recipes.data?.find((r) => r.menuItemId === e.target.value)?.components || [],
                );
              }}
            >
              <option value="">Choose menu item</option>
              {menu.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={busy || !product || !parts.length}
            onClick={() =>
              void run(async () => {
                const saved = await api<Recipe>(`/inventory/recipes/${product}`, {
                  method: 'PUT',
                  body: JSON.stringify({ version: recipeVersion, components: parts }),
                });
                setRecipeVersion(saved.version);
              })
            }
          >
            Save recipe
          </Button>
          <label>
            Supplier{' '}
            <select
              aria-label="Supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            >
              <option value="">Choose supplier</option>
              {suppliers.data?.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={busy || !supplier || !parts.length}
            onClick={() =>
              void run(async () => {
                await api('/inventory/purchases', {
                  method: 'POST',
                  body: JSON.stringify({ supplierId: supplier, lines: parts }),
                });
                setParts([]);
              })
            }
          >
            Create purchase order
          </Button>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-xl">Purchase orders</h2>
        {purchases.data?.items.map((p) => (
          <article key={p._id} className="rounded border p-4">
            <p>
              #{p._id.slice(-8)} · {suppliers.data?.find((s) => s._id === p.supplierId)?.name} ·{' '}
              {p.status}
            </p>
            {p.lines.map((l) => (
              <p key={l.ingredientId}>
                {label(l.ingredientId)} × {l.quantity}
              </p>
            ))}
            {writable &&
              p.status === 'OPEN' &&
              ['RECEIVED', 'CANCELLED'].map((status) => (
                <Button
                  disabled={busy}
                  key={status}
                  onClick={() => {
                    if (!window.confirm(`Mark purchase ${status.toLowerCase()}?`)) return;
                    void run(() =>
                      api(`/inventory/purchases/${p._id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ version: p.version, status }),
                      }),
                    );
                  }}
                >
                  {status === 'RECEIVED' ? 'Receive full order' : 'Cancel purchase'}
                </Button>
              ))}
          </article>
        ))}
        <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous purchases
        </Button>
        <Button
          disabled={page * 50 >= (purchases.data?.pagination.total || 0)}
          onClick={() => setPage(page + 1)}
        >
          Next purchases
        </Button>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl">Stock movement history</h2>
        {movements.data?.items.map((m) => (
          <p key={m._id}>
            {new Date(m.createdAt).toLocaleString()} · {label(m.ingredientId)} · {m.kind}{' '}
            {m.delta > 0 ? '+' : ''}
            {m.delta} · {m.reason}
          </p>
        ))}
        <Button disabled={historyPage === 1} onClick={() => setHistoryPage(historyPage - 1)}>
          Previous movements
        </Button>
        <Button
          disabled={historyPage * 50 >= (movements.data?.pagination.total || 0)}
          onClick={() => setHistoryPage(historyPage + 1)}
        >
          Next movements
        </Button>
      </section>
    </div>
  );
}
