import { useState } from 'react';
import { Armchair, Plus, Pencil, Archive, Map, Users, Check, Clock } from 'lucide-react';
import { toast } from 'sonner';
import type { Floor, DiningTable, TableStatus } from '@restaurant/shared';
import { useAuth } from '../auth/store';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useAllRecords, useRecords, useConfigurationRefresh } from './api';
import { ArchiveDialog, Empty, ErrorPanel, LoadingCards } from './common';
import { DiningEditor } from './dining-editor';
const labels: Record<TableStatus, string> = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  OCCUPIED: 'Occupied',
};
const statusClasses: Record<TableStatus, string> = {
  AVAILABLE: 'border-emerald-700/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  RESERVED: 'border-amber-700/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  OCCUPIED: 'border-blue-700/30 bg-blue-500/10 text-blue-800 dark:text-blue-200',
};
export function Dining() {
  const permissions = useAuth((s) => s.user!.permissions),
    canEdit = permissions.includes('tables:write'),
    canOperate = permissions.includes('tables:operate');
  const floors = useAllRecords<Floor>('floors');
  const [selected, setSelected] = useState('');
  const floor = floors.data?.find((f) => f.id === selected) ?? floors.data?.[0];
  const tables = useRecords<DiningTable>(
    'tables',
    floor ? `floorId=${floor.id}&limit=100` : 'limit=100',
  );
  const visible = floor ? (tables.data?.items.filter((t) => t.floorId === floor.id) ?? []) : [];
  const [editor, setEditor] = useState<{
      kind: 'floors' | 'tables';
      record?: Floor | DiningTable;
    } | null>(null),
    [archive, setArchive] = useState<{
      kind: 'floors' | 'tables';
      record: Floor | DiningTable;
    } | null>(null),
    [detail, setDetail] = useState<DiningTable | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const refresh = useConfigurationRefresh();
  const free = Array.from({ length: 48 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8) })).find(
    (p) => !visible.some((t) => t.x === p.x && t.y === p.y),
  );
  async function changeStatus(status: TableStatus) {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      await api(`/dining/tables/${detail.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, version: detail.version }),
      });
      await refresh();
      toast.success(`Table marked ${labels[status].toLowerCase()}`);
      setDetail(null);
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const loadError = floors.error || tables.error;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">MAKE ROOM FOR GOOD COMPANY</p>
          <h2 className="mt-2 font-serif text-3xl">Every table. One shared view.</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Plan your dining space and keep the whole team in sync.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditor({ kind: 'floors' })}>
              <Plus size={16} />
              Add floor
            </Button>
            <Button
              disabled={!floor || !free || tables.isPending}
              onClick={() => setEditor({ kind: 'tables' })}
            >
              <Plus size={16} />
              Add table
            </Button>
          </div>
        )}
      </div>
      {loadError ? (
        <ErrorPanel message={loadError.message} retry={() => void refresh()} />
      ) : floors.isPending ? (
        <LoadingCards />
      ) : !floor ? (
        <Empty
          title="A place for every guest"
          detail="Add a floor, then arrange tables to match your restaurant."
          add={canEdit ? () => setEditor({ kind: 'floors' }) : undefined}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
            {floors.data?.map((f) => (
              <Button
                key={f.id}
                variant={f.id === floor.id ? 'default' : 'ghost'}
                onClick={() => setSelected(f.id)}
              >
                <Map size={16} />
                {f.name}
              </Button>
            ))}
            {canEdit && (
              <div className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${floor.name}`}
                  onClick={() => setEditor({ kind: 'floors', record: floor })}
                >
                  <Pencil size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Archive ${floor.name}`}
                  onClick={() => setArchive({ kind: 'floors', record: floor })}
                >
                  <Archive size={16} />
                </Button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Tables', count: visible.length, icon: Map },
              {
                label: 'Available',
                count: visible.filter((t) => t.status === 'AVAILABLE').length,
                icon: Check,
              },
              {
                label: 'Occupied',
                count: visible.filter((t) => t.status === 'OCCUPIED').length,
                icon: Users,
              },
              {
                label: 'Reserved',
                count: visible.filter((t) => t.status === 'RESERVED').length,
                icon: Clock,
              },
            ].map((s) => (
              <div
                key={s.label}
                className="flex items-center gap-4 rounded-xl border border-border bg-card p-4"
              >
                <s.icon size={20} className="text-muted-foreground" />
                <div>
                  <p className="text-xl font-semibold">{tables.isPending ? '—' : s.count}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
          {tables.isPending ? (
            <LoadingCards />
          ) : (
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <h3 className="font-semibold">{floor.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {floor.description || 'Select a table to view its status.'}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {visible.reduce((sum, t) => sum + t.capacity, 0)} seats · Scroll to explore →
                </p>
              </div>
              <div className="overflow-x-auto p-4">
                <div
                  aria-label={`${floor.name} floor plan`}
                  className="relative grid min-w-[800px] grid-cols-8 grid-rows-6 gap-3 rounded-xl p-4"
                  style={{
                    backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
                    backgroundSize: '20px 20px',
                    minHeight: 600,
                  }}
                >
                  {!visible.length && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                      <Armchair size={36} />
                      <p>No tables on this floor yet.</p>
                      {canEdit && (
                        <Button variant="outline" onClick={() => setEditor({ kind: 'tables' })}>
                          Add your first table
                        </Button>
                      )}
                    </div>
                  )}
                  {visible.map((t) => (
                    <button
                      key={t.id}
                      aria-label={`${t.name}, ${t.capacity} seats, ${labels[t.status]}`}
                      style={{ gridColumn: t.x + 1, gridRow: t.y + 1 }}
                      className={cn(
                        'flex min-h-20 flex-col items-center justify-center border-2 px-1 py-3 transition-shadow hover:shadow-md focus-visible:outline-primary',
                        t.shape === 'round' ? 'rounded-[38%]' : 'rounded-xl',
                        statusClasses[t.status],
                      )}
                      onClick={() => {
                        setDetail(t);
                        setError('');
                      }}
                    >
                      <span className="max-w-full truncate px-1 text-sm font-semibold">
                        {t.name}
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-[11px]">
                        <Armchair size={12} />
                        {t.capacity} seats
                      </span>
                      <span className="mt-1 text-[10px]">{labels[t.status]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            Table status is managed manually in this phase. Order assignment, transfers between
            checks, and table history arrive with ordering in Phase 3.
          </p>
        </>
      )}
      {editor && (
        <DiningEditor
          kind={editor.kind}
          record={editor.record}
          floors={floors.data ?? []}
          floorId={floor?.id ?? ''}
          position={free ?? { x: 0, y: 0 }}
          close={() => setEditor(null)}
        />
      )}
      {archive && (
        <ArchiveDialog kind={archive.kind} record={archive.record} close={() => setArchive(null)} />
      )}
      {detail && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setDetail(null);
          }}
        >
          <DialogContent>
            <DialogTitle className="text-xl font-semibold">{detail.name}</DialogTitle>
            <DialogDescription className="mb-6 mt-2 text-sm text-muted-foreground">
              {detail.capacity} seats · {floors.data?.find((f) => f.id === detail.floorId)?.name}
            </DialogDescription>
            <p
              className={cn(
                'inline-block rounded-full border px-3 py-1.5 text-sm',
                statusClasses[detail.status],
              )}
            >
              {labels[detail.status]}
            </p>
            {canOperate && (
              <div className="mt-6 grid gap-3">
                {(detail.status === 'AVAILABLE'
                  ? ['RESERVED', 'OCCUPIED']
                  : detail.status === 'RESERVED'
                    ? ['AVAILABLE', 'OCCUPIED']
                    : ['AVAILABLE']
                ).map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    disabled={busy}
                    onClick={() => void changeStatus(s as TableStatus)}
                  >
                    {s === 'AVAILABLE'
                      ? 'Make available'
                      : s === 'OCCUPIED'
                        ? 'Seat guests'
                        : 'Reserve table'}
                  </Button>
                ))}
              </div>
            )}
            {error && (
              <p role="alert" className="mt-4 text-sm text-red-600">
                {error}
              </p>
            )}
            {canEdit && (
              <div className="mt-6 flex justify-between border-t border-border pt-4">
                <Button
                  variant="ghost"
                  disabled={busy || detail.status !== 'AVAILABLE'}
                  onClick={() => {
                    setEditor({ kind: 'tables', record: detail });
                    setDetail(null);
                  }}
                >
                  <Pencil size={16} />
                  Edit table
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || detail.status !== 'AVAILABLE'}
                  onClick={() => {
                    setArchive({ kind: 'tables', record: detail });
                    setDetail(null);
                  }}
                >
                  <Archive size={16} />
                  Archive
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
