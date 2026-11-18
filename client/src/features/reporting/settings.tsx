import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/button';
type SettingsData = { name: string; timezone: string; receiptFooter: string; version: number };
export function Settings() {
  const query = useQuery({
    queryKey: ['restaurant-settings'],
    queryFn: () => api<SettingsData>('/reporting/settings'),
  });
  const [draft, setDraft] = useState<SettingsData | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const value = draft || query.data;
  if (!value) return <p>{query.error ? query.error.message : 'Loading settings…'}</p>;
  return (
    <section className="rounded-xl border bg-card p-6 space-y-5">
      <h1 className="text-3xl">Restaurant settings</h1>
      {error && <p role="alert">{error}</p>}
      {(['name', 'timezone', 'receiptFooter'] as const).map((key) => (
        <label key={key} className="block">
          {key}
          <input
            className="block w-full rounded border bg-background p-3"
            value={value[key]}
            onChange={(e) => setDraft({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api('/reporting/settings', {
              method: 'PUT',
              body: JSON.stringify({
                name: value.name,
                timezone: value.timezone,
                receiptFooter: value.receiptFooter,
                version: value.version,
              }),
            });
            await query.refetch();
            setDraft(null);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save settings
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          setDraft(null);
          void query.refetch();
        }}
      >
        Reload settings
      </Button>
    </section>
  );
}
