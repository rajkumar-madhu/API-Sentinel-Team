import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ShieldCheck, Radar, FileSearch, Activity, ScrollText,
  Check, Lock, BadgeCheck, ChevronRight,
} from 'lucide-react';

const NAV_LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'Pricing', href: '#pricing' },
] as const;

const FEATURES = [
  {
    icon: FileSearch,
    title: 'API Discovery',
    desc: 'Inventory every endpoint, parameter, and auth surface from live traffic and OpenAPI specs.',
  },
  {
    icon: Radar,
    title: 'Active Testing',
    desc: 'OWASP-aligned templates, pentest runs, and evidence-backed findings against your real APIs.',
  },
  {
    icon: ShieldCheck,
    title: 'Runtime Protection',
    desc: 'Detect, correlate, and enforce in real time — with human-gated remediation paths.',
  },
  {
    icon: ScrollText,
    title: 'Compliance Evidence',
    desc: 'OWASP, GDPR, HIPAA, PCI-DSS, SOC 2, and NIST mappings backed by an auditable evidence trail.',
  },
] as const;

const FLOW = [
  { title: 'Discover', sub: 'Live inventory' },
  { title: 'Test', sub: 'Evidence runs' },
  { title: 'Detect', sub: 'Correlate signals' },
  { title: 'Enforce', sub: 'Controlled apply' },
  { title: 'Verify', sub: 'Post-change' },
] as const;

interface PlanCard {
  tier: string;
  price: string;
  cadence?: string;
  description: string;
  features: string[];
  highlighted?: boolean;
}

const PLANS: PlanCard[] = [
  {
    tier: 'Free',
    price: '$0',
    description: 'Get a live inventory and baseline testing running in minutes.',
    features: ['Up to 50 endpoints', '2 team members', '5 scans / month', 'API inventory & basic tests'],
  },
  {
    tier: 'Starter',
    price: '$49',
    cadence: '/mo',
    description: 'For teams shipping APIs that need continuous coverage.',
    features: ['Up to 500 endpoints', '10 team members', '50 scans / month', 'Compliance reports, Slack & Jira'],
    highlighted: true,
  },
  {
    tier: 'Pro',
    price: '$199',
    cadence: '/mo',
    description: 'Full active-testing and runtime protection for growing platforms.',
    features: ['Up to 5,000 endpoints', '50 team members', '500 scans / month', 'Source code scan, CI/CD gate, Nuclei'],
  },
  {
    tier: 'Enterprise',
    price: 'Custom',
    description: 'SSO, custom roles, unlimited scale, and dedicated support.',
    features: ['Unlimited endpoints & users', 'SSO (SAML / OIDC)', 'Custom RBAC roles', 'Dedicated support & SLAs'],
  },
];

const BrandMark: React.FC = () => (
  <div className="flex items-center gap-3">
    <div
      className="flex h-9 w-9 items-center justify-center rounded-md text-[13px] font-bold tracking-tight text-white"
      style={{
        background: 'linear-gradient(135deg, #FF5B2E 0%, #D94418 55%, #2B4CFF 120%)',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 8px 20px rgba(255,91,46,0.25)',
      }}
    >
      S
    </div>
    <div
      className="font-semibold tracking-tight"
      style={{ fontFamily: "'Fraunces', 'Plus Jakarta Sans', Georgia, serif", color: '#F4F1EA', fontSize: 15 }}
    >
      API Sentinel{' '}
      <span className="font-medium italic opacity-80" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 12 }}>
        Security
      </span>
    </div>
  </div>
);

const Landing: React.FC = () => {
  return (
    <div
      className="min-h-screen"
      style={{
        background: '#0E1116',
        color: '#F4F1EA',
        fontFamily: "'Plus Jakarta Sans', 'IBM Plex Sans', system-ui, sans-serif",
      }}
    >
      {/* Nav */}
      <header className="sticky top-0 z-10" style={{ borderBottom: '1px solid #252B36', background: 'rgba(14,17,22,0.85)', backdropFilter: 'blur(8px)' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <BrandMark />
          <nav className="hidden items-center gap-8 sm:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="text-[13px] font-medium transition-colors" style={{ color: 'rgba(200,196,188,0.75)' }}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-[13px] font-medium" style={{ color: 'rgba(244,241,234,0.9)' }}>
              Sign in
            </Link>
            <Link
              to="/login?mode=signup"
              className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-medium text-white transition-colors"
              style={{ background: '#2B4CFF' }}
            >
              Start free
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 22%, rgba(43,76,255,0.35), transparent 45%), radial-gradient(circle at 85% 8%, rgba(255,91,46,0.22), transparent 38%)',
          }}
        />
        <div className="relative mx-auto max-w-5xl px-6 pb-20 pt-16 text-center sm:pt-24">
          <p
            className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium"
            style={{ border: '1px solid rgba(255,91,46,0.3)', background: 'rgba(255,91,46,0.1)', color: 'rgba(244,241,234,0.9)' }}
          >
            <BadgeCheck className="h-3.5 w-3.5" style={{ color: '#FF5B2E' }} />
            Enterprise API security platform
          </p>
          <h1
            className="text-[2.4rem] leading-[1.1] font-semibold tracking-tight sm:text-[3.4rem]"
            style={{ fontFamily: "'Fraunces', Georgia, serif" }}
          >
            Evidence before action.
            <span
              className="mt-1 block bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(90deg, #FF5B2E, #6B85FF)', WebkitBackgroundClip: 'text' }}
            >
              Protection before breach.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[16px] leading-[1.65]" style={{ color: 'rgba(200,196,188,0.8)' }}>
            Discover, test, and protect your APIs — live inventory, correlated detections, and enforcement
            with audit-ready evidence for security teams.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login?mode=signup"
              className="inline-flex items-center gap-2 rounded-md px-5 py-3 text-[14px] font-medium text-white transition-colors"
              style={{ background: '#2B4CFF' }}
            >
              Start free — no card required
              <ArrowRight size={15} />
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-md px-5 py-3 text-[14px] font-medium"
              style={{ border: '1px solid #252B36', color: 'rgba(244,241,234,0.9)' }}
            >
              Sign in
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
            {['OWASP', 'Nuclei', 'Schemathesis', 'eBPF', 'OpenAPI', 'CI/CD Gate', 'SAML / OIDC SSO'].map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2.5 py-0.5 text-[10.5px] font-medium"
                style={{ border: '1px solid rgba(37,43,54,0.7)', background: 'rgba(26,31,40,0.4)', color: 'rgba(200,196,188,0.7)' }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Feature flow strip */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="rounded-xl p-5" style={{ border: '1px solid rgba(37,43,54,0.8)', background: 'rgba(14,17,22,0.4)' }}>
          <div
            className="mb-4 uppercase"
            style={{ fontSize: 10, letterSpacing: '0.08em', color: 'rgba(200,196,188,0.45)', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            Security capability flow
          </div>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-3">
            {FLOW.map((step, i) => (
              <div key={step.title} className="flex items-center gap-1">
                <div className="rounded-md px-3 py-2" style={{ border: '1px solid rgba(37,43,54,0.8)', background: 'rgba(26,31,40,0.5)' }}>
                  <div className="text-[12px] font-semibold" style={{ color: '#F4F1EA' }}>{step.title}</div>
                  <div className="text-[10px]" style={{ color: 'rgba(200,196,188,0.55)' }}>{step.sub}</div>
                </div>
                {i < FLOW.length - 1 && <ChevronRight className="mx-0.5 h-4 w-4 shrink-0" style={{ color: 'rgba(200,196,188,0.3)' }} />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="platform" className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl p-5" style={{ border: '1px solid rgba(37,43,54,0.9)', background: 'rgba(26,31,40,0.45)' }}>
              <Icon className="mb-3 h-5 w-5" style={{ color: '#FF5B2E' }} />
              <div className="text-[14px] font-semibold" style={{ color: '#F4F1EA' }}>{title}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: 'rgba(200,196,188,0.68)' }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 pb-24">
        <div className="mb-10 text-center">
          <h2 className="text-[1.9rem] font-semibold tracking-tight" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
            Plans that scale with your API surface
          </h2>
          <p className="mt-2 text-[14px]" style={{ color: 'rgba(200,196,188,0.7)' }}>
            Start free. Upgrade when you need more endpoints, users, or scans.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.tier}
              className="flex flex-col rounded-xl p-5"
              style={{
                border: plan.highlighted ? '1px solid rgba(255,91,46,0.5)' : '1px solid rgba(37,43,54,0.9)',
                background: plan.highlighted ? 'rgba(255,91,46,0.06)' : 'rgba(26,31,40,0.45)',
              }}
            >
              {plan.highlighted && (
                <span
                  className="mb-3 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em]"
                  style={{ background: 'rgba(255,91,46,0.15)', color: '#FF5B2E' }}
                >
                  Most popular
                </span>
              )}
              <div className="text-[13px] font-semibold" style={{ color: '#F4F1EA' }}>{plan.tier}</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-[1.8rem] font-semibold" style={{ fontFamily: "'Fraunces', Georgia, serif", color: '#F4F1EA' }}>
                  {plan.price}
                </span>
                {plan.cadence && <span className="text-[12px]" style={{ color: 'rgba(200,196,188,0.6)' }}>{plan.cadence}</span>}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'rgba(200,196,188,0.65)' }}>{plan.description}</p>
              <ul className="mt-4 flex-1 space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-[12px]" style={{ color: 'rgba(200,196,188,0.8)' }}>
                    <Check size={13} className="mt-0.5 shrink-0" style={{ color: '#6B85FF' }} />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                to="/login?mode=signup"
                className="mt-5 inline-flex items-center justify-center rounded-md px-4 py-2.5 text-[12.5px] font-medium transition-colors"
                style={{
                  background: plan.highlighted ? '#2B4CFF' : 'transparent',
                  border: plan.highlighted ? 'none' : '1px solid #252B36',
                  color: '#F4F1EA',
                }}
              >
                {plan.tier === 'Enterprise' ? 'Talk to sales' : 'Get started'}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-6 py-8" style={{ borderColor: '#252B36' }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <BrandMark />
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'rgba(200,196,188,0.5)' }}>
            <Lock className="h-3.5 w-3.5" style={{ color: 'rgba(255,91,46,0.7)' }} />
            Sessions use httpOnly cookies. Tenant data is scoped by account.
          </div>
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgba(200,196,188,0.5)' }}>
            <Activity className="h-3.5 w-3.5" style={{ color: 'rgba(43,76,255,0.7)' }} />
            Runtime detect · Audit evidence
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
