import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput, type AuthResult } from '@restaurant/shared';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  UtensilsCrossed,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useAuth } from './store';
import { api } from '../../lib/api';
export function Login() {
  const user = useAuth((s) => s.user),
    navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  if (user) return <Navigate to="/" replace />;
  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      const result = await api<AuthResult>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify(values) },
        false,
      );
      sessionStorage.removeItem('pos:locked');
      useAuth.getState().setAuth(result);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    }
  });
  return (
    <div className="login-grid min-h-screen">
      <section className="login-story relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <a
          href="/"
          className="flex items-center gap-3 text-3xl font-semibold tracking-tight text-white"
        >
          <UtensilsCrossed size={28} />
          gather<span className="text-[#e6c58e]">.</span>
        </a>
        <div className="relative z-10 max-w-lg">
          <span className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2 text-xs text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-[#dfbb79]" /> A LITTLE MORE ROOM TO FOCUS
          </span>
          <h1 className="font-serif text-6xl leading-[1.12] text-[#f6f2e7]">
            Good service.
            <br />
            Great teamwork.
            <br />
            <em className="text-[#ddbd84]">All together.</em>
          </h1>
          <p className="mt-7 max-w-sm text-base leading-7 text-white/65">
            A considered workspace for the people who make every service happen.
          </p>
          <div className="mt-10 flex gap-6 text-xs text-white/75">
            <span className="flex items-center gap-2">
              <Check size={15} />
              One restaurant
            </span>
            <span className="flex items-center gap-2">
              <Check size={15} />
              One connected team
            </span>
          </div>
        </div>
        <div className="relative z-10 flex justify-between border-t border-white/15 pt-6 text-xs text-white/50">
          <span>RESTAURANT OPERATING SYSTEM</span>
          <ArrowUpRight size={18} />
        </div>
        <div className="story-circle" />
      </section>
      <section className="flex min-h-screen flex-col bg-background p-6 sm:p-12">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold lg:invisible">gather.</span>
          <span className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
            Staff workspace
          </span>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-14">
          <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card">
            <LockKeyhole size={22} className="text-primary" />
          </div>
          <p className="eyebrow">WELCOME TO YOUR WORKSPACE</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Ready for service?</h2>
          <p className="mb-9 mt-3 text-sm leading-6 text-muted-foreground">
            Sign in with your staff account to get started.
          </p>
          {sessionStorage.getItem('pos:locked') && (
            <p role="status" className="mb-5 rounded-lg bg-muted p-3 text-sm">
              Your workspace is locked. Sign in to continue.
            </p>
          )}
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium">
                Email address
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@restaurant.com"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p id="email-error" className="mt-2 text-xs text-red-600">
                  Enter a valid email address.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="pr-12"
                  aria-invalid={!!errors.password}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? 'Hide password' : 'Show password'}
                  className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-muted-foreground"
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {errors.password && <p className="mt-2 text-xs text-red-600">Enter your password.</p>}
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}
            <Button className="h-12 w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <LoaderCircle className="animate-spin" size={18} />
              ) : (
                <>
                  Sign in to workspace
                  <ArrowRight size={17} />
                </>
              )}
            </Button>
          </form>
          <p className="mt-7 text-center text-xs leading-6 text-muted-foreground">
            Need access? Contact your restaurant administrator.
            <br />
            Your access is based on your assigned staff role.
          </p>
        </div>
        <p className="text-center text-[11px] text-muted-foreground">
          GATHER WORKSPACE <span className="mx-2">·</span> PHASE 01 / FOUNDATION
        </p>
      </section>
    </div>
  );
}
