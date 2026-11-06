import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ZodError } from 'zod';
import { floorSchema, tableSchema, type Floor, type DiningTable } from '@restaurant/shared';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Field, selectStyle } from './common';
import { saveRecord, useConfigurationRefresh } from './api';
interface Fields {
  name: string;
  description: string;
  sortOrder: number;
  floorId: string;
  capacity: number;
  column: number;
  row: number;
  shape: 'square' | 'round';
}
export function DiningEditor({
  kind,
  record,
  floors,
  floorId,
  position,
  close,
}: {
  kind: 'floors' | 'tables';
  record?: Floor | DiningTable;
  floors: Floor[];
  floorId: string;
  position: { x: number; y: number };
  close: () => void;
}) {
  const floor = record as Floor | undefined,
    table = record as DiningTable | undefined;
  const [error, setError] = useState('');
  const refresh = useConfigurationRefresh();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<Fields>({
    defaultValues: {
      name: record?.name ?? '',
      description: floor?.description ?? '',
      sortOrder: floor?.sortOrder ?? 0,
      floorId: table?.floorId ?? floorId,
      capacity: table?.capacity ?? 4,
      column: (table?.x ?? position.x) + 1,
      row: (table?.y ?? position.y) + 1,
      shape: table?.shape ?? 'square',
    },
  });
  const submit = handleSubmit(async (value) => {
    setError('');
    try {
      const fields =
        kind === 'floors'
          ? floorSchema.parse({
              name: value.name,
              description: value.description,
              sortOrder: value.sortOrder,
            })
          : tableSchema.parse({
              name: value.name,
              floorId: value.floorId,
              capacity: value.capacity,
              x: value.column - 1,
              y: value.row - 1,
              shape: value.shape,
            });
      await saveRecord(kind, fields, record);
      await refresh();
      toast.success(record ? 'Changes saved' : 'Record created');
      close();
    } catch (e) {
      setError(e instanceof ZodError ? e.issues[0].message : (e as Error).message);
    }
  });
  const title = kind === 'floors' ? 'floor' : 'table';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) close();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-xl font-semibold">
          {record ? 'Edit' : 'New'} {title}
        </DialogTitle>
        <DialogDescription className="mb-6 mt-2 text-sm text-muted-foreground">
          {kind === 'floors'
            ? 'Give each service area a clear name.'
            : 'Choose a free position on the eight-column, six-row floor plan.'}
        </DialogDescription>
        <form onSubmit={submit} className="space-y-5">
          <Field label={kind === 'floors' ? 'Floor name' : 'Table name'}>
            <Input required maxLength={80} autoFocus {...register('name')} />
          </Field>
          {kind === 'floors' ? (
            <>
              <Field label="Description">
                <textarea
                  className={`${selectStyle} h-auto py-3`}
                  rows={3}
                  maxLength={500}
                  {...register('description')}
                />
              </Field>
              <Field label="Display order">
                <Input
                  type="number"
                  min={0}
                  max={9999}
                  required
                  {...register('sortOrder', { valueAsNumber: true })}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Floor">
                <select className={selectStyle} required {...register('floorId')}>
                  <option value="">Choose a floor</option>
                  {floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Seats">
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    required
                    {...register('capacity', { valueAsNumber: true })}
                  />
                </Field>
                <Field label="Shape">
                  <select className={selectStyle} {...register('shape')}>
                    <option value="square">Square</option>
                    <option value="round">Round</option>
                  </select>
                </Field>
                <Field label="Column (1–8)">
                  <Input
                    type="number"
                    min={1}
                    max={8}
                    required
                    {...register('column', { valueAsNumber: true })}
                  />
                </Field>
                <Field label="Row (1–6)">
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    required
                    {...register('row', { valueAsNumber: true })}
                  />
                </Field>
              </div>
            </>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3 border-t border-border pt-5">
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={close}>
              Cancel
            </Button>
            <Button disabled={isSubmitting}>{isSubmitting ? 'Saving…' : `Save ${title}`}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
