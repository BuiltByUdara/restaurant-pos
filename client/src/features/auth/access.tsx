import { ShieldCheck } from 'lucide-react';
import { useAuth } from './store';
export function Access() {
  const user = useAuth((s) => s.user)!;
  return (
    <div className="max-w-3xl space-y-6">
      <section className="rounded-xl border border-border bg-card p-6">
        <ShieldCheck className="mb-5 text-primary" size={28} />
        <h2 className="text-xl font-semibold">Your workspace access</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          You are signed in as <strong className="text-foreground">{user.name}</strong> with the{' '}
          <strong className="text-foreground">{user.role}</strong> role. These permissions are
          checked on the server; menu visibility alone never grants access.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {user.permissions.map((p) => (
            <div
              key={p}
              className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {p.replace(':', ' · ')}
            </div>
          ))}
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        Some permissions apply to modules planned for later phases.
      </p>
    </div>
  );
}
