import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, Link } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { useAuth } from './features/auth/store';
import { refreshSession } from './lib/api';
import { Login } from './features/auth/login';
import { Layout } from './components/layout';
import { Workspace } from './features/workspace/home';
import { Team } from './features/staff/team';
import { Access } from './features/auth/access';
function Protected() {
  const user = useAuth((s) => s.user);
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
function StaffGuard() {
  const user = useAuth((s) => s.user);
  return user?.permissions.includes('staff:read') ? (
    <Team />
  ) : (
    <div role="alert" className="rounded-xl border border-border bg-card p-8">
      <h2 className="text-xl font-semibold">Access restricted</h2>
      <p className="mt-3 text-muted-foreground">
        Your role does not include access to staff records.
      </p>
      <Link className="mt-5 inline-block underline" to="/">
        Return to workspace
      </Link>
    </div>
  );
}
export function App() {
  const ready = useAuth((s) => s.ready),
    user = useAuth((s) => s.user);
  useEffect(() => {
    refreshSession()
      .catch(() => {})
      .finally(() => useAuth.getState().finish());
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(
      () => {
        void refreshSession().catch(() => {});
      },
      4 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, [user?.id]);
  if (!ready)
    return (
      <div role="status" className="flex min-h-screen items-center justify-center gap-3">
        <LoaderCircle className="animate-spin" />
        Opening your workspace…
      </div>
    );
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Protected />}>
          <Route element={<Layout />}>
            <Route index element={<Workspace />} />
            <Route path="team" element={<StaffGuard />} />
            <Route path="access" element={<Access />} />
            <Route
              path="*"
              element={
                <div className="p-8">
                  <h2 className="text-xl">Page not found</h2>
                  <Link className="mt-4 block underline" to="/">
                    Return to workspace
                  </Link>
                </div>
              }
            />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
