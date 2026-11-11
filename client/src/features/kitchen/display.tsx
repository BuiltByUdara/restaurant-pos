import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAuth } from '../auth/store';
import { Button } from '../../components/ui/button';
type Ticket = {
  _id: string;
  orderId: string;
  version: number;
  status: string;
  tableName: string;
  createdAt: string;
  updatedAt: string;
  lines: {
    name: string;
    quantity: number;
    notes: string;
    station: string;
    modifiers: { name: string }[];
  }[];
};
export function Kitchen() {
  const [station, setStation] = useState(''),
    [history, setHistory] = useState(false),
    [page, setPage] = useState(1),
    [now, setNow] = useState(Date.now()),
    [pending, setPending] = useState(''),
    [error, setError] = useState('');
  const canWrite = useAuth((s) => s.user?.permissions.includes('kitchen:write'));
  const query = useQuery({
    queryKey: ['kitchen', station, history, page],
    queryFn: () =>
      api<{ items: Ticket[]; stations: string[]; pagination: { total: number } }>(
        `/kitchen?page=${page}&history=${history}&station=${encodeURIComponent(station)}`,
      ),
    refetchInterval: 15000,
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function advance(ticket: Ticket) {
    setPending(ticket._id);
    setError('');
    try {
      await api(`/kitchen/${ticket._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          version: ticket.version,
          status: ticket.status === 'SUBMITTED' ? 'PREPARING' : 'READY',
        }),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await query.refetch();
      setPending('');
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Service in motion</p>
        <h1 className="mt-2 text-3xl">Kitchen display</h1>
        <p className="mt-2 text-muted-foreground">
          One ticket per order. Station filters show matching orders; actions update the whole
          ticket.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <label>
          Station{' '}
          <select
            className="rounded border bg-background p-3"
            value={station}
            onChange={(e) => {
              setStation(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All stations</option>
            {query.data?.stations.filter(Boolean).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          onClick={() => {
            setHistory(!history);
            setPage(1);
          }}
        >
          {history ? 'Active tickets' : 'Completed tickets'}
        </Button>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Refresh tickets
        </Button>
      </div>
      {(error || query.error) && (
        <p role="alert" className="rounded border p-4">
          {error || 'Kitchen data could not be loaded. Retry refresh.'}
        </p>
      )}
      {query.isLoading && <p role="status">Loading kitchen tickets…</p>}
      {query.data?.items.length === 0 && (
        <p className="rounded-xl border bg-card p-8">
          {history ? 'No completed tickets.' : 'No orders waiting here.'}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {query.data?.items.map((ticket) => (
          <article key={ticket._id} className="rounded-xl border bg-card p-5 space-y-4">
            <header>
              <p className="text-lg font-semibold">
                #{ticket.orderId.slice(-8)} · {ticket.tableName}
              </p>
              <p className="mt-2 rounded bg-primary/10 p-2 text-primary">{ticket.status}</p>
              <p className="mt-2 text-sm">
                {Math.max(
                  0,
                  Math.floor(
                    ((history ? Date.parse(ticket.updatedAt) : now) -
                      Date.parse(ticket.createdAt)) /
                      60000,
                  ),
                )}{' '}
                min {history ? 'to close' : 'elapsed'}
              </p>
            </header>
            {ticket.lines.map((line, i) => (
              <div key={i} className="border-t pt-3">
                <strong>
                  {line.quantity} × {line.name}
                </strong>
                <p className="text-sm text-muted-foreground">{line.station}</p>
                {line.modifiers.length > 0 && <p>{line.modifiers.map((m) => m.name).join(', ')}</p>}
                {line.notes && <p className="mt-2 rounded bg-secondary p-2">{line.notes}</p>}
              </div>
            ))}
            {canWrite && ['SUBMITTED', 'PREPARING'].includes(ticket.status) && (
              <Button
                className="w-full min-h-12"
                disabled={!!pending}
                onClick={() => void advance(ticket)}
              >
                {pending === ticket._id
                  ? 'Updating…'
                  : ticket.status === 'SUBMITTED'
                    ? 'Start preparing'
                    : 'Mark ready'}
              </Button>
            )}
            {ticket.status === 'READY' && <p>Waiting for service staff to mark served.</p>}
          </article>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <span>Page {page}</span>
        <Button
          disabled={page * 30 >= (query.data?.pagination.total || 0)}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
