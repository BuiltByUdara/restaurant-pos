import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { browserReceiptPrinter } from './printer';
type Job = {
  _id: string;
  kind: string;
  status: string;
  version: number;
  width: number;
  content: string[];
  attempts: number;
  leaseToken?: string;
  leaseUntil?: string;
};
export function QueuePrint({
  orderId,
  kind,
  width = 80,
}: {
  orderId: string;
  kind: 'RECEIPT' | 'KITCHEN';
  width?: 58 | 80;
}) {
  const request = useRef<{
    requestKey: string;
    orderId: string;
    kind: string;
    width: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  return (
    <div className="space-y-2">
      <Button
        disabled={busy}
        variant="outline"
        onClick={async () => {
          setBusy(true);
          setError('');
          const body = request.current || { requestKey: crypto.randomUUID(), orderId, kind, width };
          request.current = body;
          try {
            await api('/printing', { method: 'POST', body: JSON.stringify(body) });
            request.current = null;
            setMessage('Print job queued.');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {kind === 'RECEIPT' ? 'Queue receipt' : 'Queue kitchen ticket'}
      </Button>
      {message && (
        <p role="status">
          {message}{' '}
          <Link className="underline" to="/printing">
            Open print queue
          </Link>
        </p>
      )}
      {error && <p role="alert">{error} Retry uses the same request.</p>}
    </div>
  );
}
export function PrintQueue() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<Job | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['print-queue', page],
    queryFn: () => api<Job[]>(`/printing?page=${page}`),
    refetchInterval: 10000,
  });
  async function action(job: Job, name: string) {
    if (
      name === 'retry' &&
      !window.confirm('The previous attempt may have printed. Queue another attempt?')
    )
      return;
    setBusy(true);
    setError('');
    try {
      const updated = await api<Job>(`/printing/${job._id}/${name}`, {
        method: 'POST',
        body: JSON.stringify({ version: job.version }),
      });
      if (name === 'claim') {
        setSelected(updated);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        let status = 'DIALOG_OPENED';
        try {
          await browserReceiptPrinter.print();
        } catch {
          status = 'FAILED';
        }
        await api(`/printing/${job._id}/finish`, {
          method: 'POST',
          body: JSON.stringify({ leaseToken: updated.leaseToken, status }),
        });
      }
      await query.refetch();
    } catch (e) {
      setError((e as Error).message);
      await query.refetch();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <h1 className="text-3xl">Print queue</h1>
      <p>
        Only your print jobs are listed. Browser dialogs cannot prove physical printing. Confirm
        output yourself, or retry after checking for duplicates. Interrupted claims can be retried
        after five minutes.
      </p>
      {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}
      {query.isLoading && <p role="status">Loading print jobs…</p>}
      {query.data?.length === 0 && <p>No print jobs.</p>}
      {query.data?.map((job) => (
        <section key={job._id} className="rounded-xl border bg-card p-4 space-y-3">
          <h2>
            {job.kind} #{job._id.slice(-8)}
          </h2>
          <p>
            {job.status === 'CONFIRMED' ? 'Staff confirmed' : job.status} · {job.width} mm ·
            Attempts: {job.attempts}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} variant="outline" onClick={() => setSelected(job)}>
              Preview document
            </Button>
            {job.status === 'QUEUED' && (
              <Button disabled={busy} onClick={() => void action(job, 'claim')}>
                Open print dialog
              </Button>
            )}
            {job.status === 'DIALOG_OPENED' && (
              <Button disabled={busy} onClick={() => void action(job, 'confirm')}>
                Confirm paper output
              </Button>
            )}
            {(job.status === 'FAILED' ||
              job.status === 'DIALOG_OPENED' ||
              job.status === 'CONFIRMED' ||
              (job.status === 'PRINTING' && new Date(job.leaseUntil || 0).getTime() <= now)) && (
              <Button disabled={busy} variant="outline" onClick={() => void action(job, 'retry')}>
                Retry print job
              </Button>
            )}
          </div>
        </section>
      ))}
      <div className="flex gap-3">
        <Button disabled={busy || page === 1} onClick={() => setPage(page - 1)}>
          Previous jobs
        </Button>
        <Button disabled={busy || (query.data?.length || 0) < 20} onClick={() => setPage(page + 1)}>
          Next jobs
        </Button>
      </div>
      {selected && (
        <pre
          id="queued-document"
          className="whitespace-pre-wrap break-words border p-3 text-sm bg-white text-black"
          style={{ width: `${selected.width}mm` }}
        >
          {selected.content.join('\n')}
        </pre>
      )}
      <style>{`@media print { body * { visibility:hidden; } #queued-document, #queued-document * { visibility:visible; } #queued-document { position:absolute; left:0; top:0; border:0; padding:2mm; width:${selected?.width || 80}mm; } }`}</style>
    </div>
  );
}
