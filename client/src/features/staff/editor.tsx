import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { roleNames, type RoleName } from '@restaurant/shared';
import { api } from '../../lib/api';
import { useAuth } from '../auth/store';
import { Button } from '../../components/ui/button';
type Staff = {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  active: boolean;
  version: number;
};
export function StaffEditor() {
  const actor = useAuth((s) => s.user),
    cache = useQueryClient();
  const [page, setPage] = useState(1),
    [editing, setEditing] = useState<Staff | null>(null),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [role, setRole] = useState<RoleName>('Waiter'),
    [active, setActive] = useState(true),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['staff-editor', page],
    queryFn: () => api<Staff[]>(`/staff?page=${page}&limit=20`),
    enabled: !!actor?.permissions.includes('staff:write'),
  });
  if (!actor?.permissions.includes('staff:write')) return null;
  return (
    <section className="rounded-xl border bg-card p-5 space-y-4">
      <h2 className="text-xl">Manage staff</h2>
      {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}
      <div className="flex flex-wrap gap-2">
        {query.data
          ?.filter((s) => actor.role === 'Owner' || s.role !== 'Owner')
          .map((s) => (
            <Button
              key={s.id}
              variant="outline"
              onClick={() => {
                setEditing(s);
                setName(s.name);
                setEmail(s.email);
                setRole(s.role);
                setActive(s.active);
                setPassword('');
              }}
            >
              {s.name}
            </Button>
          ))}
      </div>
      <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
        Previous staff
      </Button>
      <Button
        variant="outline"
        disabled={(query.data?.length || 0) < 20}
        onClick={() => setPage(page + 1)}
      >
        Next staff
      </Button>
      <p>{editing ? `Editing ${editing.name}` : 'New staff account'}</p>
      <label className="block">
        Staff name
        <input
          className="block border bg-background p-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block">
        Staff email
        <input
          type="email"
          className="block border bg-background p-3"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="block">
        Staff role
        <select
          aria-label="Staff role"
          className="block border bg-background p-3"
          value={role}
          onChange={(e) => setRole(e.target.value as RoleName)}
        >
          {roleNames
            .filter((r) => actor.role === 'Owner' || r !== 'Owner')
            .map((r) => (
              <option key={r}>{r}</option>
            ))}
        </select>
      </label>
      <label className="block">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{' '}
        Active account
      </label>
      <label className="block">
        New password
        <input
          autoComplete="new-password"
          type="password"
          className="block border bg-background p-3"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <p>
        Use at least 14 characters. Leave blank when editing to keep the existing password. Editing
        revokes existing sessions.
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api(`/staff${editing ? '/' + editing.id : ''}`, {
              method: editing ? 'PUT' : 'POST',
              body: JSON.stringify({
                name,
                email,
                role,
                active,
                ...(password ? { password } : {}),
                ...(editing ? { version: editing.version } : {}),
              }),
            });
            setEditing(null);
            setPassword('');
            setName('');
            setEmail('');
            await cache.invalidateQueries({ queryKey: ['staff'] });
            await query.refetch();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save staff
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          setEditing(null);
          setPassword('');
          setName('');
          setEmail('');
          setActive(true);
          setRole('Waiter');
        }}
      >
        New account
      </Button>
    </section>
  );
}
