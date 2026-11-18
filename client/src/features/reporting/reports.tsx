import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { money } from '../configuration/api';
import { Button } from '../../components/ui/button';
type Row = Record<string, unknown>;
type Report = {
  timezone: string;
  cashMinor: number;
  refundMinor: number;
  charges: {
    completed: number;
    totalMinor: number;
    taxMinor: number;
    discountMinor: number;
    serviceMinor: number;
  };
  payments: Row[];
  refunds: Row[];
  orders: Row[];
  products: Row[];
  categories: Row[];
  cashiers: Row[];
  stock: Row[];
  shifts: Row[];
  recent: Row[];
  lowStock: Row[];
  hourly: { _id: string; cashMinor: number }[];
};
const text = (value: unknown): string =>
  value && typeof value === 'object'
    ? Object.values(value).map(text).join(' / ')
    : String(value ?? '');
function exportCsv(rows: Row[], name: string) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const escape = (v: unknown) => {
    const s = text(v);
    return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
  };
  const blob = new Blob(
    [
      '\uFEFF' +
        [
          keys.map(escape).join(','),
          ...rows.map((r) => keys.map((k) => escape(r[k])).join(',')),
        ].join('\r\n'),
    ],
    { type: 'text/csv;charset=utf-8' },
  );
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Reports({ dashboard = false }: { dashboard?: boolean }) {
  const settings = useQuery({
    queryKey: ['restaurant-settings'],
    queryFn: () => api<{ timezone: string }>('/reporting/settings'),
  });
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.data?.timezone || 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const query = useQuery({
    queryKey: ['report', dashboard, from || today, to || today],
    queryFn: () =>
      api<Report>(
        `/reporting/${dashboard ? 'dashboard' : 'sales'}?from=${from || today}&to=${to || today}`,
      ),
    enabled: !!settings.data,
    refetchInterval: 30000,
  });
  const data = query.data;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl">Sales dashboard & reports</h1>
      <p>
        Cash collected and refunds use their ledger dates. Product sales and bill charges use order
        completion dates. Values are in LKR.
      </p>
      <div className="flex flex-wrap gap-4">
        <label>
          From <input type="date" value={from || today} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="date" value={to || today} onChange={(e) => setTo(e.target.value)} />
        </label>
        <span>{settings.data?.timezone}</span>
        <Button
          variant="outline"
          onClick={() => {
            setFrom(today);
            setTo(today);
          }}
        >
          Today
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const date = new Date(today + 'T12:00:00Z');
            date.setUTCDate(date.getUTCDate() - 6);
            setFrom(date.toISOString().slice(0, 10));
            setTo(today);
          }}
        >
          Last 7 days
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setFrom(today.slice(0, 8) + '01');
            setTo(today);
          }}
        >
          This month
        </Button>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Refresh reports
        </Button>
      </div>
      {(query.error || settings.error) && (
        <p role="alert">{query.error?.message || settings.error?.message}</p>
      )}
      {query.isLoading && <p role="status">Loading reports…</p>}
      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ['Cash collected', data.cashMinor],
              ['Refunds', data.refundMinor],
              ['Net cash', data.cashMinor - data.refundMinor],
              [
                'Average completed order',
                data.charges.completed
                  ? Math.round(data.charges.totalMinor / data.charges.completed)
                  : 0,
              ],
              ['Tax', data.charges.taxMinor],
              ['Discounts', data.charges.discountMinor],
            ].map(([name, value]) => (
              <section key={name} className="rounded-xl border bg-card p-5">
                <h2>{name}</h2>
                <p className="text-2xl mt-3">{money(Number(value))}</p>
              </section>
            ))}
          </div>
          <p>
            Total orders created: {data.orders.reduce((sum, row) => sum + Number(row.count), 0)}.
            Active orders created:{' '}
            {data.orders
              .filter((row) => !['COMPLETED', 'CANCELLED', 'VOIDED'].includes(String(row._id)))
              .reduce((sum, row) => sum + Number(row.count), 0)}
            . Completed orders: {data.charges.completed}. Card payments: unavailable; no card
            transactions recorded.
          </p>
          <Button
            variant="outline"
            onClick={() => exportCsv([data.charges], 'tax-discount-service')}
          >
            Export charges CSV
          </Button>
          <section className="rounded-xl border bg-card p-5">
            <h2>Hourly cash collection</h2>
            {data.hourly.length === 0 && <p>No payments in this period.</p>}
            {data.hourly.map((h) => (
              <div key={h._id} className="my-3">
                <p>
                  {h._id} · {money(h.cashMinor)}
                </p>
                <div
                  className="h-4 bg-primary rounded"
                  style={{
                    width: `${Math.max(1, (h.cashMinor / Math.max(...data.hourly.map((r) => r.cashMinor), 1)) * 100)}%`,
                  }}
                />
              </div>
            ))}
          </section>
          {(
            [
              'payments',
              'refunds',
              'orders',
              'products',
              'categories',
              'cashiers',
              'stock',
              'shifts',
              'recent',
              'lowStock',
            ] as const
          ).map((section) => {
            const rows = data[section];
            const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
            return (
              <section key={section} className="rounded-xl border bg-card p-5 overflow-auto">
                <div className="flex justify-between">
                  <h2 className="text-xl">{section}</h2>
                  <Button
                    variant="outline"
                    disabled={!rows.length}
                    onClick={() => exportCsv(rows, section)}
                  >
                    Export {section} CSV
                  </Button>
                </div>
                {!rows.length ? (
                  <p className="mt-4">No records.</p>
                ) : (
                  <table className="w-full mt-4 text-sm">
                    <thead>
                      <tr>
                        {keys.map((k) => (
                          <th className="text-left p-2" key={k}>
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          {keys.map((k) => (
                            <td className="p-2 border-t" key={k}>
                              {text(r[k])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
