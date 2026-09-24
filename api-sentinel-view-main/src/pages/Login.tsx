import React from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Loader2, Eye, EyeOff, Lock, Mail, ShieldCheck, Radar, FileSearch,
  Boxes, Activity, ScrollText, ChevronRight, BadgeCheck,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { validateEmail, validatePassword } from '@/lib/validations';

const FEATURES = [
  {
    icon: FileSearch,
    title: 'API Discovery',
    desc: 'Inventory every endpoint, parameter, and auth surface from live traffic.',
  },
  {
    icon: Radar,
    title: 'Active Testing',
    desc: 'OWASP-aligned templates, pentest runs, and evidence-backed findings.',
  },
  {
    icon: ShieldCheck,
    title: 'Runtime Protection',
    desc: 'Detect, correlate, and enforce — with human-gated remediation paths.',
  },
] as const;

const FLOW = [
  { title: 'Discover', sub: 'Live inventory' },
  { title: 'Test', sub: 'Evidence runs' },
  { title: 'Detect', sub: 'Correlate signals' },
  { title: 'Enforce', sub: 'Controlled apply' },
  { title: 'Verify', sub: 'Post-change' },
] as const;

function getPasswordValidationError(password: string, isSignup: boolean): string | null {
  if (!password) {
    return 'Please enter email and password';
  }
  if (!isSignup && password.length < 6) {
    return 'Password must be at least 6 characters';
  }
  if (isSignup) {
    if (password.length < 12) {
      return 'Password must be at least 12 characters';
    }
    if (!/[A-Za-z]/.test(password)) {
      return 'Password must include at least one letter';
    }
    if (!/\d/.test(password)) {
      return 'Password must include at least one number';
    }
    if (!/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password)) {
      return 'Password must include at least one special character';
    }
  }
  return null;
}

const BrandMark: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => (
  <div className="flex items-center gap-3">
    <div
      className={`flex items-center justify-center rounded-md font-bold tracking-tight text-white ${
        size === 'md' ? 'h-10 w-10 text-[15px]' : 'h-9 w-9 text-[13px]'
      }`}
      style={{
        background: 'linear-gradient(135deg, #FF5B2E 0%, #D94418 55%, #2B4CFF 120%)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 8px 20px rgba(255,91,46,0.25)',
      }}
    >
      S
    </div>
    <div>
      <div
        className="font-semibold tracking-tight"
        style={{
          fontFamily: "'Fraunces', 'Plus Jakarta Sans', Georgia, serif",
          color: '#F4F1EA',
          fontSize: size === 'md' ? 15 : 14,
        }}
      >
        API Sentinel{' '}
        <span className="font-medium italic opacity-80" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12 }}>
          Security
        </span>
      </div>
      <div
        className="font-medium uppercase"
        style={{
          fontSize: 10.5,
          letterSpacing: '0.14em',
          color: 'rgba(200,196,188,0.6)',
          fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
        }}
      >
        sentinel · command
      </div>
    </div>
  </div>
);

const Login: React.FC = () => {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [shakeError, setShakeError] = React.useState(false);
  const [searchParams] = useSearchParams();
  const [isSignup, setIsSignup] = React.useState(() => searchParams.get('mode') === 'signup');
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const { user, login, signup, error: authError } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  if (user) return <Navigate to={from} replace />;

  const triggerShake = () => {
    setShakeError(true);
    setTimeout(() => setShakeError(false), 500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setPasswordError(null);

    const emailResult = validateEmail(email);
    if (!emailResult.valid) {
      setEmailError(emailResult.error || 'Invalid email');
      setLocalError(emailResult.error || 'Invalid email');
      triggerShake();
      return;
    }

    const passwordPolicy = getPasswordValidationError(password, isSignup);
    if (passwordPolicy) {
      setPasswordError(passwordPolicy);
      setLocalError(passwordPolicy);
      triggerShake();
      return;
    }

    const passwordResult = validatePassword(password);
    if (!passwordResult.valid) {
      setPasswordError(passwordResult.error || 'Invalid password');
      setLocalError(passwordResult.error || 'Invalid password');
      triggerShake();
      return;
    }

    setLocalError(null);
    setSubmitting(true);
    try {
      if (isSignup) {
        await signup(email, password);
      } else {
        await login(email, password);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Something went wrong. Please try again.';
      setLocalError(msg);
      triggerShake();
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = localError || authError;

  return (
    <div
      className="min-h-screen"
      style={{
        background: '#F4F1EA',
        color: '#0E1116',
        fontFamily: "'Plus Jakarta Sans', 'IBM Plex Sans', system-ui, sans-serif",
      }}
    >
      <div className="grid min-h-screen lg:grid-cols-[1.2fr_minmax(400px,480px)]">
        {/* Left — AgentOS-style dark brand panel */}
        <section
          className="relative hidden overflow-hidden lg:flex lg:flex-col"
          style={{ background: '#0E1116', color: '#C8C4BC', borderRight: '1px solid #252B36' }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'radial-gradient(circle at 18% 22%, rgba(43,76,255,0.45), transparent 45%), radial-gradient(circle at 85% 8%, rgba(255,91,46,0.28), transparent 38%)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(244,241,234,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(244,241,234,0.15) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, transparent, transparent, rgba(14,17,22,0.8))' }}
          />

          <div className="relative flex flex-1 flex-col justify-between p-10 xl:p-14">
            <BrandMark />

            <div className="my-8 max-w-xl space-y-9 xl:my-10">
              <div className="space-y-5">
                <p
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium"
                  style={{
                    border: '1px solid rgba(255,91,46,0.3)',
                    background: 'rgba(255,91,46,0.1)',
                    color: 'rgba(244,241,234,0.9)',
                  }}
                >
                  <BadgeCheck className="h-3.5 w-3.5" style={{ color: '#FF5B2E' }} />
                  Enterprise API security platform
                </p>
                <h1
                  className="text-[2.1rem] leading-[1.12] font-semibold tracking-tight xl:text-[2.5rem]"
                  style={{
                    fontFamily: "'Fraunces', Georgia, serif",
                    color: '#F4F1EA',
                  }}
                >
                  Evidence before action.
                  <span
                    className="mt-1 block bg-clip-text text-transparent"
                    style={{
                      backgroundImage: 'linear-gradient(90deg, #FF5B2E, #6B85FF)',
                      WebkitBackgroundClip: 'text',
                    }}
                  >
                    Protection before breach.
                  </span>
                </h1>
                <p className="max-w-md text-[15px] leading-[1.65]" style={{ color: 'rgba(200,196,188,0.75)' }}>
                  Discover, test, and protect your APIs — live inventory, correlated detections, and
                  enforcement with audit-ready evidence for security teams.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {FEATURES.map(({ icon: Icon, title, desc }) => (
                  <div
                    key={title}
                    className="group rounded-xl p-4 transition-colors"
                    style={{
                      border: '1px solid rgba(37,43,54,0.9)',
                      background: 'rgba(26,31,40,0.45)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(255,91,46,0.35)';
                      e.currentTarget.style.background = 'rgba(26,31,40,0.7)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(37,43,54,0.9)';
                      e.currentTarget.style.background = 'rgba(26,31,40,0.45)';
                    }}
                  >
                    <Icon className="mb-3 h-4 w-4 transition-transform group-hover:scale-105" style={{ color: '#FF5B2E' }} />
                    <div className="text-[13px] font-semibold" style={{ color: '#F4F1EA' }}>
                      {title}
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed" style={{ color: 'rgba(200,196,188,0.65)' }}>
                      {desc}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl p-4" style={{ border: '1px solid rgba(37,43,54,0.8)', background: 'rgba(14,17,22,0.4)' }}>
                <div
                  className="mb-3 uppercase"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    color: 'rgba(200,196,188,0.45)',
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  Security capability flow
                </div>
                <div className="flex flex-wrap gap-x-1 gap-y-2">
                  {FLOW.map((step, i) => (
                    <div key={step.title} className="flex items-center gap-1">
                      <div
                        className="rounded-md px-2.5 py-1.5"
                        style={{ border: '1px solid rgba(37,43,54,0.8)', background: 'rgba(26,31,40,0.5)' }}
                      >
                        <div className="text-[11px] font-semibold" style={{ color: '#F4F1EA' }}>
                          {step.title}
                        </div>
                        <div className="text-[10px]" style={{ color: 'rgba(200,196,188,0.55)' }}>
                          {step.sub}
                        </div>
                      </div>
                      {i < FLOW.length - 1 && (
                        <ChevronRight className="mx-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'rgba(200,196,188,0.3)' }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {['OWASP', 'Nuclei', 'Schemathesis', 'eBPF', 'OpenAPI', 'CI/CD Gate'].map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full px-2.5 py-0.5 text-[10.5px] font-medium"
                    style={{
                      border: '1px solid rgba(37,43,54,0.7)',
                      background: 'rgba(26,31,40,0.4)',
                      color: 'rgba(200,196,188,0.7)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <footer
              className="flex items-start gap-2.5 pt-6 text-[11px] leading-relaxed"
              style={{ borderTop: '1px solid rgba(37,43,54,0.8)', color: 'rgba(200,196,188,0.5)' }}
            >
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'rgba(255,91,46,0.7)' }} />
              <span>
                Sessions use httpOnly cookies. Tenant data is scoped by account. Active scans require an
                allowlisted target and authenticated profile.
              </span>
            </footer>
          </div>
        </section>

        {/* Right — credential panel */}
        <section className="relative flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-12 xl:px-14" style={{ background: '#F4F1EA' }}>
          {/* Mobile brand strip */}
          <div
            className="mb-8 rounded-xl p-5 lg:hidden"
            style={{ background: '#0E1116', color: '#C8C4BC', border: '1px solid #252B36' }}
          >
            <BrandMark size="sm" />
            <p className="mt-4 text-[15px] font-semibold leading-snug" style={{ color: '#F4F1EA' }}>
              Evidence before action. Protection before breach.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'rgba(200,196,188,0.7)' }}>
              Live API discovery, testing, and runtime protection.
            </p>
          </div>

          <div className="mx-auto w-full max-w-[400px] space-y-7">
            <div className="space-y-1.5 lg:pt-2">
              <h2
                className="text-[1.65rem] font-semibold tracking-tight"
                style={{ fontFamily: "'Fraunces', Georgia, serif", color: '#0E1116' }}
              >
                {isSignup ? 'Create account' : 'Welcome back'}
              </h2>
              <p className="text-[13px] leading-relaxed" style={{ color: '#5C5A56' }}>
                {isSignup
                  ? 'Set up your admin account for a new tenant workspace.'
                  : 'Sign in with your allowlisted operator credentials.'}
              </p>
            </div>

            <div
              className={`overflow-hidden rounded-xl ${shakeError ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}
              style={{
                border: '1px solid #DDD6C8',
                background: '#FFFCF7',
                boxShadow: '0 1px 2px rgba(14,17,22,0.04), 0 8px 24px rgba(14,17,22,0.06)',
              }}
            >
              <div className="px-5 py-3" style={{ borderBottom: '1px solid #DDD6C8', background: 'rgba(235,230,220,0.8)' }}>
                <p className="text-[11px] font-medium" style={{ color: '#5C5A56' }}>
                  {isSignup ? 'New admin credentials' : 'Operator credentials'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 p-5">
                {displayError && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="rounded-lg px-3.5 py-2.5 text-[13px] leading-snug"
                    style={{
                      background: 'rgba(220,38,38,0.08)',
                      border: '1px solid rgba(220,38,38,0.22)',
                      color: '#B42318',
                    }}
                  >
                    {displayError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="auth-email" className="text-xs font-medium" style={{ color: '#0E1116' }}>
                    Work email
                  </label>
                  <div className="relative">
                    <Mail
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                      style={{ color: emailError ? '#DC2626' : '#8A867E' }}
                    />
                    <input
                      id="auth-email"
                      data-testid="auth-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 w-full rounded-md border pl-10 pr-3 text-sm outline-none transition-shadow"
                      style={{
                        background: '#F4F1EA',
                        borderColor: emailError ? '#DC2626' : '#D4CDC0',
                        color: '#0E1116',
                        boxShadow: emailError ? '0 0 0 3px rgba(220,38,38,0.12)' : undefined,
                      }}
                      onFocus={(e) => {
                        if (!emailError) {
                          e.target.style.borderColor = '#2B4CFF';
                          e.target.style.boxShadow = '0 0 0 3px rgba(43,76,255,0.12)';
                        }
                      }}
                      onBlur={(e) => {
                        if (email.trim()) {
                          const result = validateEmail(email);
                          setEmailError(result.valid ? null : result.error || null);
                          e.target.style.borderColor = result.valid ? '#D4CDC0' : '#DC2626';
                          e.target.style.boxShadow = result.valid ? 'none' : '0 0 0 3px rgba(220,38,38,0.12)';
                        } else {
                          e.target.style.borderColor = '#D4CDC0';
                          e.target.style.boxShadow = 'none';
                        }
                      }}
                      placeholder="you@company.com"
                      disabled={submitting}
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                  {emailError && <p className="text-[11px]" style={{ color: '#DC2626' }}>{emailError}</p>}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="auth-password" className="text-xs font-medium" style={{ color: '#0E1116' }}>
                      Password
                    </label>
                    {!isSignup && (
                      <a href="#" className="text-[11px] font-medium hover:underline" style={{ color: '#D94418' }}>
                        Forgot?
                      </a>
                    )}
                  </div>
                  <div className="relative">
                    <Lock
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                      style={{ color: passwordError ? '#DC2626' : '#8A867E' }}
                    />
                    <input
                      id="auth-password"
                      data-testid="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 w-full rounded-md border pl-10 pr-10 text-sm outline-none transition-shadow"
                      style={{
                        background: '#F4F1EA',
                        borderColor: passwordError ? '#DC2626' : '#D4CDC0',
                        color: '#0E1116',
                        boxShadow: passwordError ? '0 0 0 3px rgba(220,38,38,0.12)' : undefined,
                      }}
                      onFocus={(e) => {
                        if (!passwordError) {
                          e.target.style.borderColor = '#2B4CFF';
                          e.target.style.boxShadow = '0 0 0 3px rgba(43,76,255,0.12)';
                        }
                      }}
                      onBlur={(e) => {
                        if (password) {
                          const result = validatePassword(password);
                          const policy = getPasswordValidationError(password, isSignup);
                          const err = !result.valid ? result.error : policy;
                          setPasswordError(err || null);
                          e.target.style.borderColor = err ? '#DC2626' : '#D4CDC0';
                          e.target.style.boxShadow = err ? '0 0 0 3px rgba(220,38,38,0.12)' : 'none';
                        } else {
                          e.target.style.borderColor = '#D4CDC0';
                          e.target.style.boxShadow = 'none';
                        }
                      }}
                      placeholder={isSignup ? 'Min 12 chars, letter, number, symbol' : 'Password'}
                      disabled={submitting}
                      autoComplete={isSignup ? 'new-password' : 'current-password'}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: '#8A867E' }}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {passwordError && <p className="text-[11px]" style={{ color: '#DC2626' }}>{passwordError}</p>}
                </div>

                {!isSignup && (
                  <label className="flex min-h-[40px] items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded"
                      style={{ accentColor: '#FF5B2E' }}
                    />
                    <span className="text-xs" style={{ color: '#5C5A56' }}>
                      Remember me
                    </span>
                  </label>
                )}

                {isSignup && !passwordError && (
                  <p className="text-[11px]" style={{ color: '#5C5A56' }}>
                    Use at least 12 characters and include a letter, number, and symbol.
                  </p>
                )}

                <button
                  data-testid="auth-submit"
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-[13px] font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: '#2B4CFF' }}
                  onMouseEnter={(e) => {
                    if (!submitting) e.currentTarget.style.background = '#FF5B2E';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#2B4CFF';
                  }}
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting
                    ? isSignup
                      ? 'Creating account…'
                      : 'Signing in…'
                    : isSignup
                      ? 'Create admin account'
                      : 'Sign in with credentials'}
                </button>
              </form>
            </div>

            <p className="text-center text-[11px] leading-relaxed" style={{ color: '#5C5A56' }}>
              {isSignup ? (
                <>
                  Already have an account?{' '}
                  <button
                    data-testid="auth-mode-toggle"
                    type="button"
                    onClick={() => {
                      setIsSignup(false);
                      setLocalError(null);
                    }}
                    className="font-semibold underline-offset-2 hover:underline"
                    style={{ color: '#D94418' }}
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  Access is limited to provisioned operators.
                  <br />
                  First time?{' '}
                  <button
                    data-testid="auth-mode-toggle"
                    type="button"
                    onClick={() => {
                      setIsSignup(true);
                      setLocalError(null);
                    }}
                    className="font-semibold underline-offset-2 hover:underline"
                    style={{ color: '#D94418' }}
                  >
                    Create admin account
                  </button>
                </>
              )}
            </p>

            <div
              className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-5 text-[10.5px]"
              style={{ borderTop: '1px solid #DDD6C8', color: '#5C5A56' }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Boxes className="h-3.5 w-3.5" style={{ color: 'rgba(43,76,255,0.7)' }} />
                Live inventory
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" style={{ color: 'rgba(43,76,255,0.7)' }} />
                Runtime detect
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ScrollText className="h-3.5 w-3.5" style={{ color: 'rgba(43,76,255,0.7)' }} />
                Audit evidence
              </span>
            </div>
          </div>
        </section>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 50%, 90% { transform: translateX(-4px); }
          30%, 70% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
};

export default Login;
