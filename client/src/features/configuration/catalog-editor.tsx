import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { ZodError } from 'zod';
import {
  categorySchema,
  modifierGroupSchema,
  menuItemSchema,
  type Category,
  type ModifierGroup,
  type MenuItem,
} from '@restaurant/shared';
import { Plus, Trash2, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Field, selectStyle } from './common';
import { parsePrice, saveRecord, useConfigurationRefresh } from './api';
export type CatalogKind = 'categories' | 'modifier-groups' | 'menu-items';
export type CatalogRecord = Category | ModifierGroup | MenuItem;
interface FormFields {
  name: string;
  description: string;
  sortOrder: number;
  price: string;
  categoryId: string;
  imageUrl: string;
  station: string;
  available: boolean;
  modifierGroupIds: string[];
  minSelections: number;
  maxSelections: number;
  options: { id: string; name: string; price: string }[];
}
export function CatalogEditor({
  kind,
  record,
  categories,
  groups,
  close,
}: {
  kind: CatalogKind;
  record?: CatalogRecord;
  categories: Category[];
  groups: ModifierGroup[];
  close: () => void;
}) {
  const menu = record as MenuItem | undefined,
    group = record as ModifierGroup | undefined;
  const [error, setError] = useState('');
  const refresh = useConfigurationRefresh();
  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormFields>({
    defaultValues: {
      name: record?.name ?? '',
      description: (record as Category)?.description ?? '',
      sortOrder: (record as Category)?.sortOrder ?? 0,
      price: ((menu?.priceMinor ?? 0) / 100).toFixed(2),
      categoryId: menu?.categoryId ?? categories[0]?.id ?? '',
      imageUrl: menu?.imageUrl ?? '',
      station: menu?.station ?? 'Kitchen',
      available: menu?.available ?? true,
      modifierGroupIds: menu?.modifierGroupIds ?? [],
      minSelections: group?.minSelections ?? 0,
      maxSelections: group?.maxSelections ?? 1,
      options: group?.options?.map((o) => ({ ...o, price: (o.priceMinor / 100).toFixed(2) })) ?? [
        { id: crypto.randomUUID(), name: '', price: '0.00' },
      ],
    },
  });
  const options = useFieldArray({ control, name: 'options', keyName: 'fieldKey' });
  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      const fields =
        kind === 'categories'
          ? categorySchema.parse({
              name: values.name,
              description: values.description,
              sortOrder: values.sortOrder,
            })
          : kind === 'modifier-groups'
            ? modifierGroupSchema.parse({
                name: values.name,
                minSelections: values.minSelections,
                maxSelections: values.maxSelections,
                options: values.options.map((o) => ({
                  id: o.id,
                  name: o.name,
                  priceMinor: parsePrice(o.price),
                })),
              })
            : menuItemSchema.parse({
                name: values.name,
                description: values.description,
                categoryId: values.categoryId,
                priceMinor: parsePrice(values.price),
                available: values.available,
                imageUrl: values.imageUrl,
                station: values.station,
                modifierGroupIds: values.modifierGroupIds,
              });
      await saveRecord(kind, fields, record);
      await refresh();
      toast.success(record ? 'Changes saved' : 'Record created');
      close();
    } catch (e) {
      setError(e instanceof ZodError ? e.issues[0].message : (e as Error).message);
    }
  });
  const title =
    kind === 'categories'
      ? 'category'
      : kind === 'modifier-groups'
        ? 'modifier group'
        : 'menu item';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) close();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogTitle className="text-xl font-semibold">
          {record ? 'Edit' : 'New'} {title}
        </DialogTitle>
        <DialogDescription className="mb-6 mt-2 text-sm text-muted-foreground">
          {kind === 'modifier-groups'
            ? 'Define choices, additional prices, and how many guests can select.'
            : 'Keep your menu clear, organized, and ready for service.'}
        </DialogDescription>
        <form onSubmit={submit} className="space-y-5">
          <Field label="Name">
            <Input {...register('name')} required maxLength={80} autoFocus />
          </Field>
          {kind !== 'modifier-groups' && (
            <Field label="Description">
              <textarea
                {...register('description')}
                rows={3}
                maxLength={500}
                className={`${selectStyle} h-auto py-3`}
              />
            </Field>
          )}
          {kind === 'categories' && (
            <Field label="Display order">
              <Input
                type="number"
                min={0}
                max={9999}
                required
                {...register('sortOrder', { valueAsNumber: true })}
              />
            </Field>
          )}
          {kind === 'menu-items' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category">
                  <select className={selectStyle} required {...register('categoryId')}>
                    <option value="">Choose a category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Price (LKR)">
                  <Input inputMode="decimal" required {...register('price')} />
                </Field>
              </div>
              <Field label="Image URL (optional)">
                <Input type="url" placeholder="https://…" {...register('imageUrl')} />
              </Field>
              <Field label="Preparation station">
                <Input required maxLength={50} {...register('station')} />
              </Field>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-primary"
                  {...register('available')}
                />
                Available to order
              </label>
              <fieldset>
                <legend className="mb-3 text-sm font-medium">Modifier groups</legend>
                {groups.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {groups.map((g) => (
                      <label
                        key={g.id}
                        className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          value={g.id}
                          className="h-5 w-5 accent-primary"
                          {...register('modifierGroupIds')}
                        />
                        {g.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No groups yet. You can add them from the Modifiers tab.
                  </p>
                )}
              </fieldset>
            </>
          )}
          {kind === 'modifier-groups' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Minimum choices">
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    required
                    {...register('minSelections', { valueAsNumber: true })}
                  />
                </Field>
                <Field label="Maximum choices">
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    required
                    {...register('maxSelections', { valueAsNumber: true })}
                  />
                </Field>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium">Choices & additional prices</h3>
                <div className="space-y-3">
                  {options.fields.map((option, index) => (
                    <div
                      key={option.fieldKey}
                      className="grid grid-cols-[1fr_110px_44px] items-end gap-2"
                    >
                      <Field label={`Option ${index + 1}`}>
                        <Input required maxLength={80} {...register(`options.${index}.name`)} />
                      </Field>
                      <Field label="Extra (LKR)">
                        <Input
                          required
                          inputMode="decimal"
                          {...register(`options.${index}.price`)}
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove option ${index + 1}`}
                        disabled={options.fields.length === 1}
                        onClick={() => options.remove(index)}
                      >
                        <Trash2 size={17} />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  disabled={options.fields.length >= 30}
                  onClick={() =>
                    options.append({ id: crypto.randomUUID(), name: '', price: '0.00' })
                  }
                >
                  <Plus size={16} />
                  Add option
                </Button>
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
            <Button disabled={isSubmitting}>
              {isSubmitting && <LoaderCircle size={16} className="animate-spin" />}Save {title}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
