import { useQuery } from '@tanstack/react-query';
import { Users, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { useState } from 'react';
interface Staff {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  lastLoginAt?: string;
}
export function Team() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['staff', page],
    queryFn: () => api<Staff[]>(`/staff?page=${page}&limit=20`),
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">The people behind every service</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Staff directory and assigned access, straight from your restaurant database.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh staff directory"
          onClick={() => q.refetch()}
        >
          <RefreshCw size={16} />
        </Button>
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        {q.isPending ? (
          <div role="status" aria-label="Loading staff" className="space-y-5 p-6">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-12 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : q.isError ? (
          <div role="alert" className="p-8">
            <p>{q.error.message}</p>
            <Button variant="outline" className="mt-4" onClick={() => q.refetch()}>
              Try again
            </Button>
          </div>
        ) : !q.data?.length ? (
          <div className="p-14 text-center text-muted-foreground">
            <Users className="mx-auto mb-4" />
            <p>No staff records on this page.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {['Team member', 'Role', 'Account', 'Last sign-in'].map((h) => (
                    <th key={h} className="px-6 py-4 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary">
                          {s.name
                            .split(' ')
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join('')}
                        </div>
                        <div className="min-w-40 font-medium">
                          {s.name}
                          <div className="mt-1 text-xs font-normal text-muted-foreground">
                            {s.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-5">{s.role}</td>
                    <td className="px-6 py-5">
                      <span className="rounded-full bg-muted px-3 py-1 text-xs">
                        {s.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-5 text-xs text-muted-foreground">
                      {s.lastLoginAt
                        ? new Date(s.lastLoginAt).toLocaleString()
                        : 'Not yet signed in'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <span className="text-xs text-muted-foreground">Page {page}</span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={!q.data || q.data.length < 20}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        Account creation, role changes, and activation controls are scheduled for the
        staff-management phase.
      </p>
    </div>
  );
}
