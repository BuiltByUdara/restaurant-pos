import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfigurationKind, Page, RecordBase } from '@restaurant/shared';
import { api } from '../../lib/api';
export function resourcePath(kind: ConfigurationKind) {
  return `/${kind === 'floors' || kind === 'tables' ? 'dining' : 'catalog'}/${kind}`;
}
export function useRecords<T>(kind: ConfigurationKind, query = '') {
  return useQuery({
    queryKey: ['configuration', kind, query],
    queryFn: () => api<Page<T>>(`${resourcePath(kind)}?${query}`),
    refetchInterval: 30000,
  });
}
export function useAllRecords<T>(kind: ConfigurationKind) {
  return useQuery({
    queryKey: ['configuration', kind, 'all'],
    queryFn: async () => {
      const items: T[] = [];
      let page = 1,
        total = 0;
      do {
        const result = await api<Page<T>>(`${resourcePath(kind)}?page=${page++}&limit=100`);
        items.push(...result.items);
        total = result.pagination.total;
        if (!result.items.length) break;
      } while (items.length < total);
      return items;
    },
    refetchInterval: 30000,
  });
}
export function useConfigurationRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['configuration'] });
}
export async function saveRecord(kind: ConfigurationKind, fields: unknown, record?: RecordBase) {
  return api<RecordBase>(resourcePath(kind) + (record ? `/${record.id}` : ''), {
    method: record ? 'PUT' : 'POST',
    body: JSON.stringify(record ? { ...(fields as object), version: record.version } : fields),
  });
}
export function money(minor: number) {
  return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(minor / 100);
}
export function parsePrice(text: string) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text))
    throw new Error('Enter a valid price with up to two decimal places.');
  const [whole, decimal = ''] = text.split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}
