import { useState } from 'react';
import { InventoryWorkflows } from './workflows';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../auth/store';
import { Button } from '../../components/ui/button';
type Ingredient = {
  _id: string;
  name: string;
  unit: string;
  stock: number;
  lowStock: number;
  version: number;
};
export function Inventory() {
  const cache = useQueryClient();
  const [page, setPage] = useState(1),
    [name, setName] = useState(''),
    [unit, setUnit] = useState('g'),
    [low, setLow] = useState('0'),
    [selected, setSelected] = useState<Ingredient | null>(null),
    [kind, setKind] = useState('RECEIVE'),
    [delta, setDelta] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const writable = useAuth((s) => s.user?.permissions.includes('inventory:write'));
  const items = useQuery({
    queryKey: ['inventory', page],
    queryFn: () =>
      api<{ items: Ingredient[]; pagination: { total: number } }>(
        `/inventory/ingredients?page=${page}`,
      ),
    refetchInterval: 15000,
  });
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await cache.invalidateQueries({ queryKey: ['inventory'] });
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6 [&_input]:rounded [&_input]:border [&_input]:bg-background [&_input]:p-3 [&_select]:border [&_select]:bg-background [&_select]:p-3">
      <h1 className="text-3xl">Inventory</h1>
      <p>
        Stock uses whole grams, millilitres or individual units. Recipes consume stock when orders
        are submitted.
      </p>
      {(error || items.error) && <p role="alert">{error || 'Could not load inventory.'}</p>}
      {items.isLoading && <p role="status">Loading ingredients…</p>}
      {writable && (
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <h2>Add ingredient</h2>
          <label>
            Name <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Unit{' '}
            <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option>g</option>
              <option>ml</option>
              <option>each</option>
            </select>
          </label>
          <label>
            Low-stock threshold{' '}
            <input type="number" min="0" value={low} onChange={(e) => setLow(e.target.value)} />
          </label>
          <Button
            disabled={busy}
            onClick={() =>
              void run(() =>
                api('/inventory/ingredients', {
                  method: 'POST',
                  body: JSON.stringify({ name, unit, lowStock: Number(low) }),
                }),
              )
            }
          >
            Add ingredient
          </Button>
        </section>
      )}
      {!items.data?.items.length && !items.isLoading && <p>No ingredients yet.</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.data?.items.map((item) => (
          <article key={item._id} className="rounded-xl border bg-card p-5 space-y-3">
            <h2>{item.name}</h2>
            <p>
              {item.stock} {item.unit}
            </p>
            {item.stock <= item.lowStock && <p className="font-semibold">Low stock</p>}
            {writable && (
              <Button variant="outline" onClick={() => setSelected(item)}>
                Record stock movement
              </Button>
            )}
          </article>
        ))}
      </div>
      {selected && (
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <h2>{selected.name}</h2>
          <label>
            Movement{' '}
            <select aria-label="Movement" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="RECEIVE">Receive</option>
              <option value="ADJUST">Adjustment</option>
              <option value="WASTE">Waste</option>
            </select>
          </label>
          <label>
            Signed quantity{' '}
            <input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} />
          </label>
          <label>
            Reason <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p>Use a positive quantity for receiving and a negative quantity for waste.</p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(() =>
                api('/inventory/movements', {
                  method: 'POST',
                  body: JSON.stringify({
                    ingredientId: selected._id,
                    version: selected.version,
                    kind,
                    delta: Number(delta),
                    reason,
                    key: crypto.randomUUID(),
                  }),
                }),
              )
            }
          >
            Save movement
          </Button>
        </section>
      )}
      <div className="flex gap-4">
        <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <span>Page {page}</span>
        <Button
          disabled={page * 50 >= (items.data?.pagination.total || 0)}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
      <InventoryWorkflows />
    </div>
  );
}
