import { useEffect, useState } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  SlidersHorizontal,
  Pencil,
  Archive,
  ChefHat,
  CheckCircle2,
  PauseCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Category, ModifierGroup, MenuItem } from '@restaurant/shared';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useAuth } from '../auth/store';
import { cn } from '../../lib/utils';
import { useRecords, useAllRecords, useConfigurationRefresh, saveRecord, money } from './api';
import { CatalogEditor, type CatalogKind, type CatalogRecord } from './catalog-editor';
import { ArchiveDialog, Empty, ErrorPanel, LoadingCards, Pagination, selectStyle } from './common';
export function Catalog() {
  const canEdit = useAuth((s) => s.user!.permissions.includes('menu:write'));
  const [kind, setKind] = useState<CatalogKind>('menu-items'),
    [search, setSearch] = useState(''),
    [debounced, setDebounced] = useState(''),
    [category, setCategory] = useState(''),
    [page, setPage] = useState(1),
    [sort, setSort] = useState('name'),
    [availability, setAvailability] = useState('');
  const [editor, setEditor] = useState<{ record?: CatalogRecord } | null>(null),
    [archive, setArchive] = useState<CatalogRecord | null>(null),
    [busy, setBusy] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const cats = useAllRecords<Category>('categories'),
    groups = useAllRecords<ModifierGroup>('modifier-groups');
  const params = new URLSearchParams({ page: String(page), limit: '12', search: debounced, sort });
  if (kind === 'menu-items' && category) params.set('categoryId', category);
  if (kind === 'menu-items' && availability) params.set('available', availability);
  const q = useRecords<CatalogRecord>(kind, params.toString()),
    refresh = useConfigurationRefresh();
  useEffect(() => {
    if (q.data) {
      const last = Math.max(1, Math.ceil(q.data.pagination.total / 12));
      if (page > last) setPage(last);
    }
  }, [q.data, page]);
  function changeTab(next: CatalogKind) {
    setKind(next);
    setPage(1);
    setSearch('');
    setDebounced('');
    setCategory('');
    setAvailability('');
  }
  async function toggle(item: MenuItem) {
    setBusy(item.id);
    try {
      await saveRecord(
        'menu-items',
        {
          name: item.name,
          description: item.description,
          priceMinor: item.priceMinor,
          categoryId: item.categoryId,
          imageUrl: item.imageUrl,
          station: item.station,
          modifierGroupIds: item.modifierGroupIds,
          available: !item.available,
        },
        item,
      );
      await refresh();
      toast.success(item.available ? 'Item marked unavailable' : 'Item available to order');
    } catch (e) {
      toast.error((e as Error).message);
      await refresh();
    } finally {
      setBusy('');
    }
  }
  const error = q.error || cats.error || groups.error;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">THE RESTAURANT COLLECTION</p>
          <h2 className="mt-2 font-serif text-3xl">Your menu, thoughtfully arranged.</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Organize your dishes, shape the choices, and keep availability up to date.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => setEditor({})}
            disabled={kind === 'menu-items' && !cats.data?.length}
          >
            <Plus size={17} />
            Add{' '}
            {kind === 'menu-items'
              ? 'menu item'
              : kind === 'categories'
                ? 'category'
                : 'modifier group'}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-b border-border pb-4">
        {(
          [
            { id: 'menu-items', name: 'Menu items', icon: BookOpen },
            { id: 'categories', name: 'Categories', icon: ChefHat },
            { id: 'modifier-groups', name: 'Modifiers', icon: SlidersHorizontal },
          ] as const
        ).map((tab) => (
          <Button
            key={tab.id}
            variant={kind === tab.id ? 'default' : 'ghost'}
            onClick={() => changeTab(tab.id)}
          >
            <tab.icon size={17} />
            {tab.name}
          </Button>
        ))}
      </div>
      {kind === 'menu-items' && cats.data?.length === 0 && !cats.isPending && canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm">
          <p>Create a category before adding your first dish.</p>
          <Button variant="outline" onClick={() => changeTab('categories')}>
            Manage categories
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search size={17} className="absolute left-3 top-4 text-muted-foreground" />
          <Input
            aria-label="Search menu records"
            placeholder="Search by name…"
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {kind === 'menu-items' && (
          <>
            <select
              aria-label="Filter by category"
              className={cn(selectStyle, 'w-full sm:w-auto')}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {cats.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by availability"
              className={cn(selectStyle, 'w-full sm:w-auto')}
              value={availability}
              onChange={(e) => {
                setAvailability(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Any availability</option>
              <option value="true">Available</option>
              <option value="false">Unavailable</option>
            </select>
          </>
        )}
        <select
          aria-label="Sort records"
          className={cn(selectStyle, 'w-full sm:w-auto')}
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
        >
          <option value="name">{kind === 'categories' ? 'Display order' : 'Name A–Z'}</option>
          <option value="newest">Newest first</option>
        </select>
      </div>
      {error ? (
        <ErrorPanel message={error.message} retry={() => void refresh()} />
      ) : q.isPending || cats.isPending || groups.isPending ? (
        <LoadingCards />
      ) : !q.data?.items.length ? (
        <Empty
          title="Nothing on the menu here yet"
          detail={
            debounced || category || availability
              ? 'Try a different search or filter.'
              : 'Add your own restaurant records to get started.'
          }
          add={
            canEdit && !(kind === 'menu-items' && !cats.data?.length)
              ? () => setEditor({})
              : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {q.data.items.map((record) => {
              const item = record as MenuItem,
                group = record as ModifierGroup,
                cat = record as Category;
              return (
                <article
                  key={record.id}
                  className="overflow-hidden rounded-xl border border-border bg-card"
                >
                  {kind === 'menu-items' && (
                    <div className="relative flex h-32 items-center justify-center overflow-hidden bg-gradient-to-br from-primary/10 to-amber-400/10">
                      <ChefHat size={46} strokeWidth={1} className="text-primary/40" />
                      {item.imageUrl && (
                        <img
                          key={item.imageUrl}
                          src={item.imageUrl}
                          alt={item.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="absolute inset-0 h-full w-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      )}
                      <span
                        className={cn(
                          'absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                          item.available
                            ? 'border-emerald-700/20 bg-card text-primary'
                            : 'border-amber-700/20 bg-card text-amber-700',
                        )}
                      >
                        {item.available ? 'Available' : 'Unavailable'}
                      </span>
                    </div>
                  )}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-semibold">{record.name}</h3>
                      {kind === 'menu-items' && (
                        <span className="whitespace-nowrap text-sm font-semibold text-primary">
                          {money(item.priceMinor)}
                        </span>
                      )}
                    </div>
                    {kind === 'menu-items' ? (
                      <>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {cats.data?.find((c) => c.id === item.categoryId)?.name} · {item.station}
                        </p>
                        <p className="mt-4 min-h-10 text-sm leading-6 text-muted-foreground">
                          {item.description || 'No description added.'}
                        </p>
                        {item.modifierGroupIds.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1">
                            {item.modifierGroupIds.map((id) => (
                              <span key={id} className="rounded bg-muted px-2 py-1 text-[10px]">
                                {groups.data?.find((g) => g.id === id)?.name ?? 'Modifier group'}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    ) : kind === 'categories' ? (
                      <>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                          {cat.description || 'No description added.'}
                        </p>
                        <p className="mt-4 text-xs text-muted-foreground">
                          Display order: {cat.sortOrder}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Choose {group.minSelections}–{group.maxSelections} ·{' '}
                          {group.minSelections > 0 ? 'Required' : 'Optional'}
                        </p>
                        <ul className="mt-4 space-y-2">
                          {group.options.map((o) => (
                            <li key={o.id} className="flex justify-between gap-2 text-sm">
                              <span>{o.name}</span>
                              <span className="text-muted-foreground">
                                {o.priceMinor ? `+${money(o.priceMinor)}` : 'Included'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {canEdit && (
                      <div className="mt-5 flex flex-wrap gap-1 border-t border-border pt-3">
                        <Button
                          variant="ghost"
                          onClick={() => setEditor({ record })}
                          aria-label={`Edit ${record.name}`}
                        >
                          <Pencil size={15} />
                          Edit
                        </Button>
                        {kind === 'menu-items' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy === record.id}
                            aria-label={`Mark ${record.name} ${item.available ? 'unavailable' : 'available'}`}
                            onClick={() => void toggle(item)}
                          >
                            {item.available ? (
                              <PauseCircle size={18} />
                            ) : (
                              <CheckCircle2 size={18} />
                            )}
                          </Button>
                        )}
                        <Button
                          className="ml-auto"
                          variant="ghost"
                          size="icon"
                          aria-label={`Archive ${record.name}`}
                          onClick={() => setArchive(record)}
                        >
                          <Archive size={16} />
                        </Button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <Pagination page={page} total={q.data.pagination.total} limit={12} onChange={setPage} />
        </>
      )}
      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          You have read-only menu access. Ask your manager to update the menu.
        </p>
      )}
      {editor && (
        <CatalogEditor
          key={`${kind}-${editor.record?.id ?? 'new'}`}
          kind={kind}
          record={editor.record}
          categories={cats.data ?? []}
          groups={groups.data ?? []}
          close={() => setEditor(null)}
        />
      )}
      {archive && <ArchiveDialog kind={kind} record={archive} close={() => setArchive(null)} />}
    </div>
  );
}
