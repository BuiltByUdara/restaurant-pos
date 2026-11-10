import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChefHat,
  LockKeyhole,
  ShieldCheck,
  Users,
  LayoutGrid,
  ReceiptText,
  Package,
} from 'lucide-react';
import { useAuth } from '../auth/store';
import { Button } from '../../components/ui/button';
export function Workspace() {
  const user = useAuth((s) => s.user)!;
  return (
    <div className="space-y-7">
      <section className="welcome-card relative overflow-hidden rounded-2xl p-7 text-white sm:p-9">
        <div className="relative z-10 max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#e8c789]" /> YOUR TEAM’S STARTING POINT
          </span>
          <h2 className="mb-3 mt-6 font-serif text-3xl sm:text-4xl">
            Welcome in, {user.name.split(' ')[0]}.
          </h2>
          <p className="max-w-md text-sm leading-7 text-white/75">
            Your restaurant is taking shape. Organize your menu, arrange your tables, and keep your
            team connected.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {user.permissions.includes('menu:read') && (
              <Button asChild className="bg-[#efe7d6] text-[#234238] hover:bg-white">
                <Link to="/menu">
                  Explore your menu
                  <ArrowRight size={16} />
                </Link>
              </Button>
            )}
            {user.permissions.includes('staff:read') && (
              <Button asChild className="bg-[#efe7d6] text-[#234238] hover:bg-white">
                <Link to="/team">
                  View your team
                  <ArrowRight size={16} />
                </Link>
              </Button>
            )}
            <span className="inline-flex items-center gap-2 px-2 text-xs text-white/70">
              <ShieldCheck size={16} />
              Authenticated staff access
            </span>
          </div>
        </div>
        <UtensilArtwork />
      </section>
      <div className="grid gap-5 md:grid-cols-3">
        <InfoCard
          icon={Users}
          title="Your role"
          value={user.role}
          detail="Permissions assigned by your restaurant"
        />
        <InfoCard
          icon={ShieldCheck}
          title="Access controls"
          value={`${user.permissions.length} permissions`}
          detail="Enforced by the server on every request"
        />
        <InfoCard
          icon={LockKeyhole}
          title="Session protection"
          value="5-minute auto-lock"
          detail="Your workspace locks when you step away"
        />
      </div>
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Building a better service</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Implementation progress, with a clear place for every part of your restaurant.
            </p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
            Phase 3 of 8
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: ShieldCheck, name: 'Staff & access', phase: 'Phase 01', done: true },
            { icon: LayoutGrid, name: 'Menu & tables', phase: 'Phase 02', done: true },
            { icon: ReceiptText, name: 'POS & orders', phase: 'Phase 03', done: true },
            { icon: Package, name: 'Stock & insights', phase: 'Phases 06–07' },
          ].map((item) => (
            <div key={item.name} className="rounded-xl border border-border p-4">
              <div className="mb-5 flex items-center justify-between">
                <item.icon
                  size={21}
                  className={item.done ? 'text-primary' : 'text-muted-foreground'}
                />
                {item.done && <Check size={16} className="text-primary" />}
              </div>
              <h3 className="text-sm font-medium">{item.name}</h3>
              <p className="mt-2 text-xs text-muted-foreground">
                {item.phase} · {item.done ? 'Available' : 'Planned'}
              </p>
            </div>
          ))}
        </div>
      </section>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <ChefHat size={16} className="shrink-0" />
        Menu, floor management and POS ordering are ready. Kitchen tickets and billing arrive in the
        following phases.
      </p>
    </div>
  );
}
function InfoCard({
  icon: Icon,
  title,
  value,
  detail,
}: {
  icon: typeof Users;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{title}</span>
        <Icon size={17} />
      </div>
      <p className="mb-2 mt-4 text-xl font-semibold tracking-tight">{value}</p>
      <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}
function UtensilArtwork() {
  return (
    <div
      aria-hidden
      className="absolute -right-10 top-7 hidden h-64 w-64 rounded-full border border-white/10 p-7 xl:block"
    >
      <div className="h-full w-full rounded-full border border-white/15 p-7">
        <div className="flex h-full w-full items-center justify-center rounded-full border border-white/20">
          <ChefHat size={58} strokeWidth={1} className="text-[#e4c994]/70" />
        </div>
      </div>
    </div>
  );
}
