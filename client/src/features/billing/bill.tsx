import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { browserReceiptPrinter } from './printer';
import { useAuth } from '../auth/store';
import { money, parsePrice } from '../configuration/api';
import { Button } from '../../components/ui/button';
type BillData = {
  order: {
    _id: string;
    version: number;
    status: string;
    customerName: string;
    createdAt: string;
    lines: {
      name: string;
      quantity: number;
      unitPriceMinor: number;
      modifiers: { name: string; priceMinor: number }[];
    }[];
  };
  bill: {
    subtotalMinor: number;
    discountMinor: number;
    serviceMinor: number;
    taxMinor: number;
    totalMinor: number;
  };
  balanceMinor: number;
  payments: { _id: string; amountMinor: number; tenderedMinor: number; changeMinor: number }[];
  refunds: { paymentId: string; amountMinor: number; reason: string }[];
};
export function BillPanel({ id }: { id: string }) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['bill', id],
    queryFn: () => api<BillData>(`/billing/orders/${id}`),
    refetchInterval: 10000,
  });
  const permissions = useAuth((s) => s.user?.permissions || []);
  const [discount, setDiscount] = useState('0'),
    [tax, setTax] = useState('0'),
    [service, setService] = useState('0'),
    [refund, setRefund] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [width, setWidth] = useState('80');
  const [retry, setRetry] = useState<{ path: string; body: object } | null>(null);
  async function act(path: string, body: object, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      await api(path, { method, body: JSON.stringify(body) });
      setRetry(null);
      await query.refetch();
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['shifts'] }),
        cache.invalidateQueries({ queryKey: ['orders'] }),
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setRetry(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const data = query.data;
  if (!data) return <p role="status">{query.error ? 'Could not load bill.' : 'Loading bill…'}</p>;
  return (
    <section className="rounded-xl border bg-card p-5 space-y-4 [&_input]:rounded-lg [&_input]:border [&_input]:bg-background [&_input]:p-3">
      <h2 className="text-xl">Bill #{id.slice(-8)}</h2>
      {error && <p role="alert">{error}</p>}
      <div id="receipt" style={{ maxWidth: `${width}mm` }}>
        <h3>Gather Restaurant</h3>
        <p>
          Order #{id.slice(-8)} · {data.order.status}
        </p>
        <p>{new Date(data.order.createdAt).toLocaleString()}</p>
        {data.order.lines.map((l, i) => (
          <p key={i}>
            {l.quantity} × {l.name} —{' '}
            {money(
              l.quantity * (l.unitPriceMinor + l.modifiers.reduce((s, m) => s + m.priceMinor, 0)),
            )}
          </p>
        ))}
        <hr />
        {Object.entries(data.bill)
          .filter(([k]) =>
            ['subtotalMinor', 'discountMinor', 'serviceMinor', 'taxMinor', 'totalMinor'].includes(
              k,
            ),
          )
          .map(([k, v]) => (
            <p key={k}>
              {k.replace('Minor', '')}: {money(v)}
            </p>
          ))}
        <p>Balance: {money(data.balanceMinor)}</p>
        {data.payments.map((p) => (
          <p key={p._id}>
            Cash {money(p.amountMinor)} · received {money(p.tenderedMinor)} · change{' '}
            {money(p.changeMinor)}
          </p>
        ))}
        {data.refunds.map((r, i) => (
          <p key={i}>
            Refund {money(r.amountMinor)} · {r.reason}
          </p>
        ))}
        <p>Thank you for dining with us.</p>
      </div>
      <label>
        Receipt width{' '}
        <select value={width} onChange={(e) => setWidth(e.target.value)}>
          <option value="80">80 mm</option>
          <option value="58">58 mm</option>
        </select>
      </label>
      <Button
        onClick={() =>
          void (async () => {
            setError('');
            let jobId = '';
            try {
              const job = await api<{ _id: string }>('/billing/print-jobs', {
                method: 'POST',
                body: JSON.stringify({ orderId: id, width: Number(width) }),
              });
              jobId = job._id;
              await browserReceiptPrinter.print();
              await api(`/billing/print-jobs/${jobId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: 'DIALOG_OPENED' }),
              });
            } catch (e) {
              setError('Printing failed. Use Print receipt to retry.');
              if (jobId)
                await api(`/billing/print-jobs/${jobId}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ status: 'FAILED' }),
                }).catch(() => {});
            }
          })()
        }
      >
        Print receipt
      </Button>
      <style>{`@media print { body * { visibility:hidden; } #receipt, #receipt * { visibility:visible; } #receipt { position:absolute; left:0; top:0; width:${width}mm; color:black; background:white; font-size:12px; } }`}</style>
      {permissions.includes('orders:approve') &&
        data.order.status === 'SERVED' &&
        !data.payments.length && (
          <fieldset disabled={busy || !!retry} className="space-y-3">
            <legend>Manager bill adjustments</legend>
            <label className="block">
              Discount (LKR){' '}
              <input value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </label>
            <label className="block">
              Tax (%) <input value={tax} onChange={(e) => setTax(e.target.value)} />
            </label>
            <label className="block">
              Service (%) <input value={service} onChange={(e) => setService(e.target.value)} />
            </label>
            <Button
              onClick={() => {
                try {
                  void act(
                    `/billing/orders/${id}/bill`,
                    {
                      version: data.order.version,
                      discountMinor: parsePrice(discount),
                      taxBasisPoints: parsePrice(tax),
                      serviceBasisPoints: parsePrice(service),
                    },
                    'PUT',
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Apply adjustments
            </Button>
          </fieldset>
        )}
      {permissions.includes('refunds:approve') && (
        <fieldset disabled={busy || !!retry}>
          <legend>Refund cash payment</legend>
          <label className="block">
            Refund amount <input value={refund} onChange={(e) => setRefund(e.target.value)} />
          </label>
          <label className="block">
            Refund reason <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {data.payments.map((p) => (
            <Button
              key={p._id}
              variant="outline"
              onClick={() => {
                try {
                  const request = {
                    path: '/billing/refunds',
                    body: {
                      kind: 'REFUND',
                      paymentId: p._id,
                      amountMinor: parsePrice(refund),
                      reason,
                      idempotencyKey: crypto.randomUUID(),
                    },
                  };
                  if (!window.confirm('Confirm cash refund?')) return;
                  setRetry(request);
                  void act(request.path, request.body);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Refund payment {p._id.slice(-6)}
            </Button>
          ))}
        </fieldset>
      )}
      {retry && (
        <Button disabled={busy} onClick={() => void act(retry.path, retry.body)}>
          Retry same refund
        </Button>
      )}
    </section>
  );
}
