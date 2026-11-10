import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import {
  UtensilsCrossed,
  LayoutDashboard,
  Users,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  LogOut,
  LockKeyhole,
  Search,
  ShoppingBasket,
  ChefHat,
  ReceiptText,
  Package,
  BarChart3,
  Settings,
  Menu,
  BookOpen,
  LayoutGrid,
} from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { useAuth } from '../features/auth/store';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

export function Layout() {
  const user = useAuth((s) => s.user)!,
    token = useAuth((s) => s.token),
    queryClient = useQueryClient(),
    location = useLocation();
  const [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [dark, setDark] = useState(localStorage.getItem('pos:theme') === 'dark'),
    [confirm, setConfirm] = useState(false),
    [live, setLive] = useState(false);
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ status: string }>('/health'),
    refetchInterval: 30000,
    retry: 1,
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('pos:theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    if (!token) return;
    const socket = io({ auth: { token } });
    socket.on('session:ready', () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      setLive(true);
      void queryClient.invalidateQueries({ queryKey: ['configuration'] });
    });
    const refreshConfiguration = () => {
      void queryClient.invalidateQueries({ queryKey: ['configuration'] });
    };
    socket.on('catalog:changed', refreshConfiguration);
    socket.on('tables:changed', refreshConfiguration);
    socket.on('orders:changed', () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    });
    socket.on('disconnect', () => setLive(false));
    socket.on('connect_error', () => setLive(false));
    return () => {
      socket.disconnect();
    };
  }, [token]);
  async function leave(lock = false) {
    sessionStorage.setItem('pos:locked', '1');
    const pending = api<void>('/auth/logout', { method: 'POST' }, false);
    useAuth.getState().clear();
    queryClient.clear();
    const channel = new BroadcastChannel('pos:session');
    channel.postMessage('logout');
    channel.close();
    try {
      await pending;
      if (!lock) sessionStorage.removeItem('pos:locked');
    } catch {
      toast.error('Server sign-out could not be confirmed. This screen remains locked.');
    }
  }
  useEffect(() => {
    const channel = new BroadcastChannel('pos:session');
    channel.onmessage = () => {
      sessionStorage.setItem('pos:locked', '1');
      useAuth.getState().clear();
      queryClient.clear();
    };
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void leave(true), 5 * 60 * 1000);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void leave(true);
      }
    };
    reset();
    ['pointerdown', 'keydown', 'touchstart'].forEach((name) =>
      window.addEventListener(name, reset),
    );
    window.addEventListener('keydown', keyboard);
    return () => {
      clearTimeout(timer);
      channel.close();
      ['pointerdown', 'keydown', 'touchstart'].forEach((name) =>
        window.removeEventListener(name, reset),
      );
      window.removeEventListener('keydown', keyboard);
    };
  }, []);
  const title =
    location.pathname === '/team'
      ? 'Your team'
      : location.pathname === '/access'
        ? 'Access & security'
        : location.pathname === '/menu'
          ? 'Menu collection'
          : location.pathname === '/tables'
            ? 'Floor plan'
            : location.pathname === '/pos'
              ? 'Point of sale'
              : 'Workspace overview';
  return (
    <div className="min-h-screen bg-background">
      <a href="#main-content" className="sr-only z-50 bg-card p-4 focus:not-sr-only focus:fixed">
        Skip to content
      </a>
      {mobile && (
        <button
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-card transition-[width,transform]',
          collapsed ? 'w-20' : 'w-64',
          mobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className={cn('flex h-24 shrink-0 items-center gap-3 px-7', collapsed && 'px-6')}>
          <UtensilsCrossed className="shrink-0 text-primary" size={26} />
          {!collapsed && (
            <span className="text-3xl font-semibold tracking-tight">
              gather<span className="text-[#b18b4c]">.</span>
            </span>
          )}
        </div>
        {!collapsed && (
          <div className="mx-5 mb-7 shrink-0 rounded-lg border border-border px-4 py-3">
            <div className="text-xs font-semibold">Restaurant workspace</div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Single location · Staff portal
            </div>
          </div>
        )}
        <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
          {!collapsed && <p className="eyebrow px-3 pb-3">WORKSPACE</p>}
          {[
            { to: '/', label: 'Overview', icon: LayoutDashboard },
            ...(user.permissions.includes('orders:write')
              ? [{ to: '/pos', label: 'Point of sale', icon: ShoppingBasket }]
              : []),
            ...(user.permissions.includes('menu:read')
              ? [{ to: '/menu', label: 'Menu collection', icon: BookOpen }]
              : []),
            ...(user.permissions.includes('tables:read')
              ? [{ to: '/tables', label: 'Floor plan', icon: LayoutGrid }]
              : []),
            ...(user.permissions.includes('staff:read')
              ? [{ to: '/team', label: 'Your team', icon: Users }]
              : []),
            { to: '/access', label: 'Access & security', icon: ShieldCheck },
          ].map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end
              onClick={() => setMobile(false)}
              title={collapsed ? n.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm',
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted',
                )
              }
            >
              <n.icon size={19} className="shrink-0" />
              <span className={collapsed ? 'sr-only' : ''}>{n.label}</span>
            </NavLink>
          ))}
          {!collapsed && <p className="eyebrow px-3 pb-2 pt-7">COMING NEXT</p>}
          {[
            { label: 'Kitchen', icon: ChefHat },
            { label: 'Orders & bills', icon: ReceiptText },
            { label: 'Inventory', icon: Package },
            { label: 'Reports', icon: BarChart3 },
            { label: 'Settings', icon: Settings },
          ].map((n) => (
            <div
              key={n.label}
              title={`${n.label} — planned for a later phase`}
              className="flex min-h-11 items-center gap-3 px-3 text-sm text-muted-foreground/65"
            >
              <n.icon size={18} className="shrink-0" />
              {!collapsed && (
                <>
                  <span>{n.label}</span>
                  <LockKeyhole size={11} className="ml-auto" />
                </>
              )}
            </div>
          ))}
        </nav>
        <div className="mt-auto shrink-0 border-t border-border p-4">
          <Button
            variant="ghost"
            className="w-full justify-start px-2"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen size={20} />
            ) : (
              <>
                <PanelLeftClose size={20} />
                <span>Collapse sidebar</span>
              </>
            )}
          </Button>
          {!collapsed && (
            <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  health.isSuccess ? 'bg-emerald-600' : 'bg-amber-500',
                )}
              />
              {health.isSuccess ? 'Database connected' : 'Checking connection'}
              <span className="ml-auto">v0.3</span>
            </div>
          )}
        </div>
      </aside>
      <div className={cn('transition-[margin-left]', collapsed ? 'lg:ml-20' : 'lg:ml-64')}>
        <header className="flex h-24 items-center justify-between gap-3 border-b border-border bg-card/60 px-5 sm:px-9">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobile(!mobile)}
              aria-label="Toggle navigation"
            >
              <Menu size={21} />
            </Button>
            <div>
              <p className="eyebrow hidden sm:block">YOUR RESTAURANT, CONNECTED</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="mr-4 hidden text-xs text-muted-foreground xl:block">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'long',
              })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDark(!dark)}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void leave(true)}
              title="Lock workspace (Alt+L)"
              aria-label="Lock workspace"
            >
              <LockKeyhole size={18} />
            </Button>
            <div className="mx-2 hidden h-8 w-px bg-border sm:block" />
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold">{user.name}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{user.role}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setConfirm(true)}
              aria-label="Sign out"
            >
              <LogOut size={18} />
            </Button>
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-[1500px] px-5 py-7 sm:px-9">
          <div className="mb-6 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Workspace <span className="mx-2 text-border">/</span>{' '}
              <span className="text-foreground">{title}</span>
            </p>
            <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span
                className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-600' : 'bg-amber-500')}
              />
              {live ? 'Live connection' : 'Reconnecting'}
            </span>
          </div>
          <Outlet />
        </main>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle className="text-xl font-semibold">End your session?</DialogTitle>
          <DialogDescription className="mb-6 mt-3 text-sm leading-6 text-muted-foreground">
            This will sign you out and revoke this session on the server.
          </DialogDescription>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Stay signed in
            </Button>
            <Button onClick={() => void leave()}>Sign out</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
