import { useState } from 'react';
import { BillPanel } from './bill';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { money, parsePrice } from '../configuration/api';
import { Button } from '../../components/ui/button';
type Shift = {
  _id: string;
  status: string;
  version: number;
  openingMinor: number;
  expectedMinor?: number;
  differenceMinor?: number;
};
type Order = { _id: string; status: string; version: number; subtotalMinor: number };
export function Cashier() {
  const [page, setPage] = useState(1),
    [billId, setBillId] = useState(''),
    [movement, setMovement] = useState(''),
    [movementReason, setMovementReason] = useState('');
  const shifts = useQuery({
    queryKey: ['shifts'],
    queryFn: () => api<Shift[]>('/billing/shifts'),
    refetchInterval: 15000,
  });
  const orders = useQuery({
    queryKey: ['orders', 'cashier', page],
    queryFn: () => api<{ items: Order[]; pagination: { total: number } }>(`/orders?page=${page}`),
    refetchInterval: 15000,
  });
  const [opening, setOpening] = useState('0'),
    [counted, setCounted] = useState('0'),
    [amount, setAmount] = useState(''),
    [tendered, setTendered] = useState(''),
    [selected, setSelected] = useState<Order | null>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<object | null>(null);
  const [movementRetry, setMovementRetry] = useState<object | null>(null);
  const shift = shifts.data?.find((s) => s.status === 'OPEN');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await shifts.refetch();
      await orders.refetch();
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setPending(null);
        setMovementRetry(null);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6 [&_input]:rounded-lg [&_input]:border [&_input]:border-border [&_input]:bg-background [&_input]:p-3 [&_label]:mr-3">
      <h1 className="text-3xl">Cashier</h1>
      <p>Cash payments only. Card acceptance is not configured.</p>
      {(error || shifts.error || orders.error) && (
        <p role="alert">{error || 'Could not load cashier data.'}</p>
      )}
      {message && <p role="status">{message}</p>}
      <section className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="text-xl">Your shift</h2>
        {shift ? (
          <>
            <p>Opening cash: {money(shift.openingMinor)}</p>
            <label>
              Counted cash{' '}
              <input
                className="border bg-background p-2"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || !!pending}
              onClick={() => {
                if (!window.confirm('Close your cash drawer shift?')) return;
                void run(async () => {
                  const result = await api<Shift>(`/billing/shifts/${shift._id}/close`, {
                    method: 'POST',
                    body: JSON.stringify({
                      version: shift.version,
                      countedMinor: parsePrice(counted),
                    }),
                  });
                  setMessage(
                    `Shift closed. Expected ${money(result.expectedMinor!)}; difference ${money(result.differenceMinor!)}`,
                  );
                });
              }}
            >
              Close shift
            </Button>
          </>
        ) : (
          <>
            <label>
              Opening cash{' '}
              <input
                className="border bg-background p-2"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || shifts.isLoading}
              onClick={() =>
                void run(async () => {
                  await api('/billing/shifts', {
                    method: 'POST',
                    body: JSON.stringify({ openingMinor: parsePrice(opening) }),
                  });
                })
              }
            >
              Open shift
            </Button>
          </>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl">Recent served orders</h2>
        {orders.data?.items
          .filter((o) => o.status === 'SERVED')
          .map((o) => (
            <Button
              variant="outline"
              disabled={busy || !!pending}
              key={o._id}
              onClick={() => {
                setSelected(o);
                setAmount('');
                setTendered('');
              }}
            >
              #{o._id.slice(-8)} · subtotal {money(o.subtotalMinor)}
            </Button>
          ))}
        <p>
          Enter the amount to apply and cash received. The server checks the outstanding balance.
        </p>
      </section>
      {selected && (
        <section className="rounded-xl border bg-card p-5 space-y-4">
          <h2>Payment for #{selected._id.slice(-8)}</h2>
          <label className="block">
            Amount to apply{' '}
            <input
              disabled={!!pending || busy}
              className="border bg-background p-2"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="block">
            Cash received{' '}
            <input
              disabled={!!pending || busy}
              className="border bg-background p-2"
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !shift}
            onClick={() =>
              void run(async () => {
                const body = pending || {
                  orderId: selected._id,
                  version: selected.version,
                  amountMinor: parsePrice(amount),
                  tenderedMinor: parsePrice(tendered),
                  idempotencyKey: crypto.randomUUID(),
                };
                setPending(body);
                const paid = await api<{ changeMinor: number }>('/billing/payments/cash', {
                  method: 'POST',
                  body: JSON.stringify(body),
                });
                setMessage(`Payment recorded. Change: ${money(paid.changeMinor)}`);
                setPending(null);
                setSelected(null);
              })
            }
          >
            {pending ? 'Retry same payment' : 'Record cash payment'}
          </Button>
          {pending && (
            <p>
              Keep this screen open if the result is uncertain. Retry uses the same payment key.
            </p>
          )}
        </section>
      )}
      <section className="space-y-3">
        <h2>Cash drawer movements</h2>
        <label>
          Amount <input value={movement} onChange={(e) => setMovement(e.target.value)} />
        </label>
        <label>
          Reason{' '}
          <input value={movementReason} onChange={(e) => setMovementReason(e.target.value)} />
        </label>
        {['IN', 'OUT'].map((kind) => (
          <Button
            key={kind}
            disabled={busy || !shift}
            onClick={() =>
              void run(async () => {
                const body = movementRetry || {
                  kind,
                  amountMinor: parsePrice(movement),
                  reason: movementReason,
                  idempotencyKey: crypto.randomUUID(),
                };
                setMovementRetry(body);
                await api('/billing/movements', { method: 'POST', body: JSON.stringify(body) });
                setMovementRetry(null);
                setMessage(`Cash ${kind.toLowerCase()} recorded.`);
              })
            }
          >
            {movementRetry ? 'Retry pending movement' : `Cash ${kind.toLowerCase()}`}
          </Button>
        ))}
      </section>
      <section className="space-y-3">
        <h2>Bills and receipts</h2>
        {orders.data?.items.map((o) => (
          <Button variant="outline" key={o._id} onClick={() => setBillId(o._id)}>
            Bill #{o._id.slice(-8)}
          </Button>
        ))}
        <div>
          <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous orders
          </Button>
          <Button
            disabled={page * 30 >= (orders.data?.pagination.total || 0)}
            onClick={() => setPage(page + 1)}
          >
            Next orders
          </Button>
        </div>
      </section>
      {billId && <BillPanel key={billId} id={billId} />}
      <section>
        <h2>Shift history</h2>
        {shifts.data
          ?.filter((s) => s.status === 'CLOSED')
          .map((s) => (
            <p key={s._id}>
              #{s._id.slice(-8)} · expected {money(s.expectedMinor!)} · difference{' '}
              {money(s.differenceMinor!)}
            </p>
          ))}
      </section>
    </div>
  );
}
