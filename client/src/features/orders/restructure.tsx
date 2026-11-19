import { useState } from 'react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/button';
type Order = {
  _id: string;
  version: number;
  status: string;
  lines: { name: string; quantity: number }[];
};
export function Restructure({
  order,
  orders,
  changed,
}: {
  order: Order;
  orders: Order[];
  changed: () => void;
}) {
  const [quantities, setQuantities] = useState<number[]>(order.lines.map(() => 0));
  const [sourceId, setSourceId] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(action: string, body: object) {
    if (!window.confirm(`Confirm ${action} of these unpaid orders?`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/orders/${order._id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ version: order.version, ...body }),
      });
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const source = orders.find((o) => o._id === sourceId);
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3>Split or merge unpaid orders</h3>
      <p>
        Move selected quantities to a separate bill. The new bill has no table; the original keeps
        its table. Bill adjustments and existing payments must be absent.
      </p>
      {error && <p role="alert">{error}</p>}
      {order.lines.map((line, i) => (
        <label key={i} className="block">
          Move {line.name}
          <input
            aria-label={`Split quantity ${i + 1}`}
            className="ml-3 border p-2 bg-background"
            type="number"
            min="0"
            max={line.quantity}
            value={quantities[i]}
            onChange={(e) =>
              setQuantities(
                quantities.map((q, index) => (index === i ? Number(e.target.value) : q)),
              )
            }
          />
        </label>
      ))}
      <Button disabled={busy} onClick={() => void submit('split', { quantities })}>
        Split selected items
      </Button>
      <label className="block">
        Merge source order
        <select
          aria-label="Merge source order"
          className="ml-3 border p-2 bg-background"
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
        >
          <option value="">Choose an order</option>
          {orders
            .filter((o) => o._id !== order._id && o.status === order.status)
            .map((o) => (
              <option key={o._id} value={o._id}>
                #{o._id.slice(-8)}
              </option>
            ))}
        </select>
      </label>
      <Button
        disabled={busy || !source}
        onClick={() => source && void submit('merge', { sourceId, sourceVersion: source.version })}
      >
        Merge into this order
      </Button>
    </section>
  );
}
