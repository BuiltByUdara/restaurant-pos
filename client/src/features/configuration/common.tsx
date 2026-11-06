import { useState, useId, cloneElement } from 'react';
import { LoaderCircle, AlertCircle, Plus, PackageOpen } from 'lucide-react';
import { toast } from 'sonner';
import type { ConfigurationKind, RecordBase } from '@restaurant/shared';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { api } from '../../lib/api';
import { resourcePath, useConfigurationRefresh } from './api';

export const selectStyle =
  'h-12 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-primary';
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  const generatedId = useId();
  const id = children.props.id ?? generatedId;
  return (
    <div className="grid gap-2 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}
export function ErrorPanel({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-border bg-card p-8">
      <AlertCircle className="mb-4 text-amber-600" />
      <p>{message}</p>
      <Button variant="outline" className="mt-4" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
export function LoadingCards() {
  return (
    <div
      role="status"
      aria-label="Loading records"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <div key={n} className="h-48 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
export function Empty({ title, detail, add }: { title: string; detail: string; add?: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
      <PackageOpen className="mx-auto mb-5 text-muted-foreground" size={32} />
      <h2 className="font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{detail}</p>
      {add && (
        <Button className="mt-6" onClick={add}>
          <Plus size={16} />
          Add the first one
        </Button>
      )}
    </div>
  );
}
export function Pagination({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-5">
      <span className="text-xs text-muted-foreground">
        {total} records · Page {page} of {Math.max(1, Math.ceil(total / limit))}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={page * limit >= total}
          onClick={() => onChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export function ArchiveDialog({
  kind,
  record,
  close,
}: {
  kind: ConfigurationKind;
  record: RecordBase & { name: string };
  close: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const refresh = useConfigurationRefresh();
  async function archive() {
    setBusy(true);
    setError('');
    try {
      await api(`${resourcePath(kind)}/${record.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: record.version }),
      });
      await refresh();
      toast.success('Record archived');
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent>
        <DialogTitle className="text-xl font-semibold">Archive {record.name}?</DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-6 text-muted-foreground">
          This removes it from active screens while retaining its history. Records still in use
          cannot be archived.
        </DialogDescription>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" disabled={busy} onClick={close}>
            Keep record
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void archive()}>
            {busy ? <LoaderCircle className="animate-spin" size={16} /> : 'Archive'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
