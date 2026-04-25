import { useState } from 'react';
import {
  Shield, Activity, GitBranch, Bell, FileText, Search,
  CheckCircle, ChevronDown, ChevronUp, Mail, ArrowRight,
  Terminal, Lock, BarChart2, Zap, Users, Server
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface LandingProps {
  onNavigate: (page: string) => void;
}

function HeroSection() {
  const heroVideoSrc = `${import.meta.env.BASE_URL}hero-preview.mp4`;
  const heroImageSrc = `${import.meta.env.BASE_URL}Bounty-rotation.jpeg`;
  const [hasHeroVideo, setHasHeroVideo] = useState(true);

  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
      <div className="absolute inset-0 bg-[#050d1a]">
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: `linear-gradient(rgba(14, 165, 233, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(14, 165, 233, 0.3) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }} />
        <div className="absolute right-0 top-0 w-1/2 h-full opacity-20 bg-gradient-to-l from-[#0ea5e9]/10 to-transparent" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center py-16 lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0ea5e9]/10 border border-[#0ea5e9]/30 text-[#0ea5e9] text-xs font-medium mb-6 uppercase tracking-wider">
              <Activity className="w-3 h-3" />
              Security Monitoring &amp; Engineering Operations
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
              GMX Audit<br />
              <span className="text-[#0ea5e9]">Control Center</span>
            </h1>

            <p className="text-lg text-[#94a3b8] mb-4 leading-relaxed">
              Security monitoring, CI coverage, and regression support for teams shipping critical infrastructure.
            </p>

            <p className="text-[#64748b] mb-10 leading-relaxed text-sm max-w-lg">
              GMX Audit Control Center helps engineering and protocol teams improve release confidence with monitoring, CI validation, regression coverage, and audit-oriented operational support. We provide digital security and engineering support services for teams that need reliable release controls, faster issue detection, and clearer operational visibility.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href="#pricing"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#0ea5e9] hover:bg-[#0284c7] text-white font-semibold rounded-lg transition-all duration-200 shadow-lg shadow-[#0ea5e9]/20"
              >
                View Plans
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href="#lead-capture"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-transparent hover:bg-[#0a1628] text-white font-medium rounded-lg border border-[#1a2f4a] hover:border-[#0ea5e9]/50 transition-all duration-200"
              >
                Request Access
              </a>
              <a
                href="#contact"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-transparent hover:bg-[#0a1628] text-[#94a3b8] hover:text-white font-medium rounded-lg transition-all duration-200"
              >
                Contact Us
              </a>
            </div>
          </div>

          <div className="relative lg:flex justify-end hidden">
            <div className="relative w-full max-w-lg space-y-6">
              <div className="absolute -inset-1 bg-gradient-to-r from-[#0ea5e9]/30 to-[#10b981]/30 rounded-2xl blur-lg opacity-60" />

              {hasHeroVideo && (
                <div className="relative rounded-2xl overflow-hidden border border-[#1a2f4a] shadow-2xl bg-[#050d1a]">
                  <video
                    src={heroVideoSrc}
                    autoPlay
                    muted
                    loop
                    playsInline
                    controls
                    onError={() => setHasHeroVideo(false)}
                    className="w-full h-auto object-cover"
                  />
                  <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-[#050d1a]/40 via-transparent to-transparent" />
                  <div className="absolute top-3 left-3 bg-[#0ea5e9] text-white text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wider uppercase">
                    Video Preview
                  </div>
                </div>
              )}

              <div className="relative rounded-2xl overflow-hidden border border-[#1a2f4a] shadow-2xl">
                <img
                  src={heroImageSrc}
                  alt="GMX Audit Security Dashboard"
                  className="w-full h-auto object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#050d1a]/60 via-transparent to-transparent" />
              </div>
              <div className="absolute -top-3 -right-3 bg-[#10b981] text-white text-xs font-bold px-3 py-1 rounded-full">
                LIVE MONITORING
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBand() {
  const labels = [
    { icon: <Server className="w-4 h-4" />, label: 'Protocol Teams' },
    { icon: <Shield className="w-4 h-4" />, label: 'Smart Contract Teams' },
    { icon: <Terminal className="w-4 h-4" />, label: 'Infrastructure Teams' },
    { icon: <GitBranch className="w-4 h-4" />, label: 'Engineering Operations' },
    { icon: <Lock className="w-4 h-4" />, label: 'Security-Critical Releases' },
  ];

  return (
    <section className="border-y border-[#1a2f4a] bg-[#030810] py-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
          {labels.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-[#475569] hover:text-[#64748b] transition-colors">
              <span className="text-[#1a2f4a]">{item.icon}</span>
              <span className="text-xs font-medium tracking-wider uppercase">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhatWeOffer() {
  const features = [
    {
      icon: <Activity className="w-5 h-5 text-[#0ea5e9]" />,
      title: 'CI Monitoring',
      desc: 'Continuous integration pipeline monitoring with automated failure detection and alert routing.',
    },
    {
      icon: <GitBranch className="w-5 h-5 text-[#10b981]" />,
      title: 'Regression Coverage',
      desc: 'Structured regression workflows that catch behavioral drift before it reaches production.',
    },
    {
      icon: <Bell className="w-5 h-5 text-[#0ea5e9]" />,
      title: 'Alerting and Issue Triage',
      desc: 'High-signal alerting with severity classification and structured triage workflows.',
    },
    {
      icon: <FileText className="w-5 h-5 text-[#10b981]" />,
      title: 'Artifact and Evidence Tracking',
      desc: 'Organized tracking of audit artifacts, test outputs, and release evidence for compliance and review.',
    },
    {
      icon: <Search className="w-5 h-5 text-[#0ea5e9]" />,
      title: 'Audit-Oriented Workflows',
      desc: 'Engineering workflows designed around audit readiness, structured findings, and traceable operations.',
    },
    {
      icon: <BarChart2 className="w-5 h-5 text-[#10b981]" />,
      title: 'Operational Visibility',
      desc: 'Clear dashboards and reporting to give teams a reliable view of release health and risk exposure.',
    },
  ];

  return (
    <section id="services" className="py-24 bg-[#050d1a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-14">
          <p className="text-[#0ea5e9] text-xs font-semibold uppercase tracking-wider mb-3">What We Offer</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Continuous monitoring and engineering assurance
          </h2>
          <p className="text-[#64748b] leading-relaxed">
            We help teams reduce release risk with structured monitoring, coverage validation, and operational support — delivered remotely and digitally for engineering, protocol, and infrastructure teams.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={i}
              className="bg-[#0a1628] border border-[#1a2f4a] hover:border-[#0ea5e9]/30 rounded-xl p-6 transition-all duration-200 group"
            >
              <div className="w-10 h-10 rounded-lg bg-[#050d1a] border border-[#1a2f4a] flex items-center justify-center mb-4 group-hover:border-[#0ea5e9]/30 transition-colors">
                {f.icon}
              </div>
              <h3 className="text-white font-semibold mb-2">{f.title}</h3>
              <p className="text-[#64748b] text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-[#475569] text-sm">
          All services are delivered digitally for engineering, protocol, and infrastructure teams.
        </p>
      </div>
    </section>
  );
}

function PricingSection() {
  const plans = [
    {
      title: 'Growth — CI Basic',
      price: '$499',
      period: '/month',
      desc: 'For teams that want a reliable quality gate.',
      accent: 'border-[#0ea5e9]/40',
      badgeColor: 'bg-[#0ea5e9]/10 text-[#0ea5e9] border-[#0ea5e9]/30',
      badge: 'Starter',
      features: [
        'Nightly or weekly rotation',
        'CI failure triage',
        'Alerts and notifications',
        'Artifact tracking',
        'Multi-chain monitoring support',
      ],
      cta: 'Buy Growth — CI Basic',
      ctaStyle: 'bg-[#0ea5e9] hover:bg-[#0284c7] text-white shadow-lg shadow-[#0ea5e9]/20',
      href: 'https://buy.stripe.com/fZu9AT3Np2Sp48l4NygnK00',
      external: true,
    },
    {
      title: 'Progression Pro',
      price: 'Custom',
      period: '',
      desc: 'For teams that need broader operational coverage and stronger release confidence.',
      accent: 'border-[#06b6d4]/40',
      badgeColor: 'bg-[#06b6d4]/10 text-[#06b6d4] border-[#06b6d4]/30',
      badge: 'Premium',
      features: [
        'Expanded monitoring coverage',
        'Faster issue response workflows',
        'Higher-touch operational support',
        'Broader release validation',
        'Escalation support',
      ],
      cta: 'Talk to Sales',
      ctaStyle: 'bg-[#06b6d4]/10 hover:bg-[#06b6d4]/20 text-[#06b6d4] border border-[#06b6d4]/30',
      href: '#contact',
      external: false,
    },
    {
      title: 'Regression Pro',
      price: '$2,500',
      period: '/month',
      desc: 'For teams that need stronger regression protection and production confidence.',
      accent: 'border-[#10b981]/40',
      badgeColor: 'bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30',
      badge: 'Advanced',
      features: [
        'Advanced regression coverage',
        'Priority issue triage',
        'Expanded alerts and operational visibility',
        'Release risk reduction support',
        'High-signal monitoring workflows',
      ],
      cta: 'Buy Regression Pro',
      ctaStyle: 'bg-[#10b981] hover:bg-[#059669] text-white shadow-lg shadow-[#10b981]/20',
      href: 'https://buy.stripe.com/28E3cv6ZBcsZeMZ93OgnK01',
      external: true,
    },
    {
      title: 'One-Time Audit / Advisory',
      price: 'Custom',
      period: '',
      desc: 'For teams that need a one-time security review, release review, or engineering advisory engagement.',
      accent: 'border-[#475569]/40',
      badgeColor: 'bg-[#475569]/10 text-[#94a3b8] border-[#475569]/30',
      badge: 'Scoped',
      features: [
        'One-time scoped engagement',
        'Findings summary',
        'Recommendations',
        'Delivery window defined before purchase',
      ],
      cta: 'Request One-Time Review',
      ctaStyle: 'bg-[#1a2f4a] hover:bg-[#243b55] text-white border border-[#2a3f5a]',
      href: '#contact',
      external: false,
    },
  ];

  return (
    <section id="pricing" className="py-24 bg-[#030810]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-[#0ea5e9] text-xs font-semibold uppercase tracking-wider mb-3">Pricing</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Plans and Engagements</h2>
          <p className="text-[#64748b]">Choose a recurring plan or request a scoped one-time engagement. All services are delivered digitally.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {plans.map((plan, i) => (
            <div
              key={i}
              className={`relative bg-[#0a1628] border ${plan.accent} rounded-xl p-6 flex flex-col transition-all duration-200 hover:translate-y-[-2px]`}
            >
              <div className="mb-4">
                <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full border ${plan.badgeColor}`}>
                  {plan.badge}
                </span>
              </div>
              <h3 className="text-white font-bold text-lg mb-2">{plan.title}</h3>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-bold text-white">{plan.price}</span>
                {plan.period && <span className="text-[#64748b] text-sm">{plan.period}</span>}
              </div>
              <p className="text-[#64748b] text-sm mb-6 leading-relaxed">{plan.desc}</p>

              <ul className="space-y-2.5 mb-8 flex-1">
                {plan.features.map((feat, fi) => (
                  <li key={fi} className="flex items-start gap-2 text-sm text-[#94a3b8]">
                    <CheckCircle className="w-4 h-4 text-[#10b981] mt-0.5 flex-shrink-0" />
                    {feat}
                  </li>
                ))}
              </ul>

              {plan.external ? (
                <a
                  href={plan.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm text-center transition-all duration-200 ${plan.ctaStyle}`}
                >
                  {plan.cta}
                </a>
              ) : (
                <a
                  href={plan.href}
                  className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm text-center transition-all duration-200 ${plan.ctaStyle}`}
                >
                  {plan.cta}
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: '01',
      icon: <Search className="w-5 h-5 text-[#0ea5e9]" />,
      title: 'Choose a plan or request a scoped engagement',
      desc: 'Select the plan that fits your team or contact us to scope a custom engagement.',
    },
    {
      num: '02',
      icon: <CheckCircle className="w-5 h-5 text-[#10b981]" />,
      title: 'Complete checkout or contact us',
      desc: 'Purchase via Stripe for monthly plans, or get in touch to define your engagement terms.',
    },
    {
      num: '03',
      icon: <Users className="w-5 h-5 text-[#0ea5e9]" />,
      title: 'We confirm scope, access needs, and start date',
      desc: 'We align on delivery expectations, access requirements, and timeline before any work begins.',
    },
    {
      num: '04',
      icon: <Zap className="w-5 h-5 text-[#10b981]" />,
      title: 'Services are delivered digitally',
      desc: 'Monitoring, reporting, alerts, and findings are delivered remotely to your team.',
    },
  ];

  return (
    <section id="how-it-works" className="py-24 bg-[#050d1a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-[#0ea5e9] text-xs font-semibold uppercase tracking-wider mb-3">Process</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">How Delivery Works</h2>
          <p className="text-[#64748b]">A straightforward process with clear expectations from day one.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step, i) => (
            <div key={i} className="relative">
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-8 left-full w-full h-px bg-gradient-to-r from-[#1a2f4a] to-transparent z-0" />
              )}
              <div className="bg-[#0a1628] border border-[#1a2f4a] rounded-xl p-6 relative z-10 h-full">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[#1a2f4a] font-bold text-xl font-mono">{step.num}</span>
                  <div className="w-9 h-9 rounded-lg bg-[#050d1a] border border-[#1a2f4a] flex items-center justify-center">
                    {step.icon}
                  </div>
                </div>
                <h3 className="text-white font-semibold mb-2 text-sm leading-snug">{step.title}</h3>
                <p className="text-[#64748b] text-xs leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhoThisIsFor() {
  const audiences = [
    {
      icon: <Server className="w-5 h-5 text-[#0ea5e9]" />,
      title: 'Protocol Teams',
      desc: 'Teams building and maintaining on-chain protocols that need continuous monitoring and audit-ready operations.',
    },
    {
      icon: <Shield className="w-5 h-5 text-[#10b981]" />,
      title: 'Smart Contract Teams',
      desc: 'Development teams shipping smart contracts who need regression coverage and CI validation workflows.',
    },
    {
      icon: <Terminal className="w-4 h-4 text-[#0ea5e9]" />,
      title: 'Infrastructure Teams',
      desc: 'Infrastructure operators managing critical systems who need reliable alerting and issue triage.',
    },
    {
      icon: <GitBranch className="w-5 h-5 text-[#10b981]" />,
      title: 'Teams Shipping High-Risk Releases',
      desc: 'Engineering teams that require stronger release controls and operational visibility before deployment.',
    },
    {
      icon: <Activity className="w-5 h-5 text-[#0ea5e9]" />,
      title: 'CI and Regression-Focused Teams',
      desc: 'Teams that want structured CI quality gates and regression confidence as part of their release process.',
    },
    {
      icon: <BarChart2 className="w-5 h-5 text-[#10b981]" />,
      title: 'Audit-Preparedness Oriented Teams',
      desc: 'Teams that need structured evidence tracking and audit-ready artifact management for external reviews.',
    },
  ];

  return (
    <section className="py-24 bg-[#030810]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-[#0ea5e9] text-xs font-semibold uppercase tracking-wider mb-3">Audience</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Who This Is For</h2>
          <p className="text-[#64748b]">Built for engineering and protocol teams where release quality and operational confidence are non-negotiable.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {audiences.map((a, i) => (
            <div
              key={i}
              className="flex items-start gap-4 bg-[#0a1628] border border-[#1a2f4a] hover:border-[#0ea5e9]/20 rounded-xl p-5 transition-all duration-200"
            >
              <div className="w-9 h-9 rounded-lg bg-[#050d1a] border border-[#1a2f4a] flex items-center justify-center flex-shrink-0 mt-0.5">
                {a.icon}
              </div>
              <div>
                <h3 className="text-white font-semibold text-sm mb-1">{a.title}</h3>
                <p className="text-[#64748b] text-xs leading-relaxed">{a.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  const [open, setOpen] = useState<number | null>(null);

  const faqs = [
    {
      q: 'What are you selling?',
      a: 'Digital security and engineering support services, including CI monitoring, regression coverage, alerting, triage, and audit-oriented operational support.',
    },
    {
      q: 'How is the service delivered?',
      a: 'Remotely and digitally through monitoring workflows, alerts, reporting artifacts, and scoped engineering support. No on-site presence is required.',
    },
    {
      q: 'Who is this for?',
      a: 'Protocol, smart contract, infrastructure, and engineering teams that need stronger release controls and operational visibility.',
    },
    {
      q: 'How do we get started?',
      a: 'Choose a plan or contact us for a scoped engagement. We confirm delivery expectations before work begins.',
    },
    {
      q: 'Are custom scopes available?',
      a: 'Yes. Progression Pro and one-time advisory engagements can be scoped based on protocol needs. Contact us to begin the scoping process.',
    },
    {
      q: 'How is billing handled?',
      a: 'Monthly plans are billed via Stripe at the time of purchase and on a recurring monthly basis. Custom engagements are invoiced per agreed terms before work begins.',
    },
  ];

  return (
    <section id="faq" className="py-24 bg-[#050d1a]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14">
          <p className="text-[#0ea5e9] text-xs font-semibold uppercase tracking-wider mb-3">FAQ</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white">Common Questions</h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="bg-[#0a1628] border border-[#1a2f4a] rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between px-6 py-4 text-left group"
              >
                <span className="text-white font-medium text-sm group-hover:text-[#0ea5e9] transition-colors pr-4">
                  {faq.q}
                </span>
                {open === i
                  ? <ChevronUp className="w-4 h-4 text-[#0ea5e9] flex-shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-[#475569] flex-shrink-0" />
                }
              </button>
              {open === i && (
                <div className="px-6 pb-5 text-[#94a3b8] text-sm leading-relaxed border-t border-[#1a2f4a] pt-4">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LeadCaptureSection() {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    if (!isSupabaseConfigured || !supabase) {
      setStatus('error');
      return;
    }

    setStatus('loading');

    const { error } = await supabase.from('lead_captures').insert({ email, company });

    if (error) {
      setStatus('error');
    } else {
      setStatus('success');
      setEmail('');
      setCompany('');
    }
  };

  return (
    <section id="lead-capture" className="py-24 bg-[#030810]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-[#0a1628] border border-[#1a2f4a] rounded-2xl p-8 sm:p-10">
            <div className="mb-8">
              <p className="text-[#0ea5e9] text-xs font-semibold uppercase tracking-wider mb-3">Get Updates</p>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
                Get updates or request a scoped engagement
              </h2>
              <p className="text-[#64748b] text-sm leading-relaxed">
                Share your email to receive product updates, service availability, or to start a conversation about a custom engagement.
              </p>
            </div>

            {status === 'success' ? (
              <div className="flex items-center gap-3 bg-[#10b981]/10 border border-[#10b981]/30 rounded-lg px-5 py-4">
                <CheckCircle className="w-5 h-5 text-[#10b981] flex-shrink-0" />
                <p className="text-[#10b981] text-sm font-medium">Request received. We will be in touch shortly.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[#64748b] text-xs font-medium mb-1.5 uppercase tracking-wider">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full bg-[#050d1a] border border-[#1a2f4a] focus:border-[#0ea5e9] rounded-lg px-4 py-3 text-white text-sm placeholder-[#334155] outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[#64748b] text-xs font-medium mb-1.5 uppercase tracking-wider">
                    Company / Team Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Your protocol or team name"
                    className="w-full bg-[#050d1a] border border-[#1a2f4a] focus:border-[#0ea5e9] rounded-lg px-4 py-3 text-white text-sm placeholder-[#334155] outline-none transition-colors"
                  />
                </div>

                {status === 'error' && (
                  <p className="text-red-400 text-xs">Something went wrong. Please try again or email us directly.</p>
                )}

                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="w-full py-3 bg-[#0ea5e9] hover:bg-[#0284c7] disabled:opacity-60 text-white font-semibold rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
                >
                  {status === 'loading' ? 'Submitting...' : 'Request Access'}
                  {status !== 'loading' && <ArrowRight className="w-4 h-4" />}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ContactSection() {
  return (
    <section id="contact" className="py-24 bg-[#050d1a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-xl mx-auto text-center">
          <p className="text-[#0ea5e9] text-xs font-semibold uppercase tracking-wider mb-3">Contact</p>
          <h2 className="text-3xl font-bold text-white mb-4">Get in Touch</h2>
          <p className="text-[#64748b] text-sm mb-8 leading-relaxed">
            For scoped engagement inquiries, custom pricing questions, or general support, reach out directly.
          </p>

          <div className="bg-[#0a1628] border border-[#1a2f4a] rounded-xl p-8 text-left space-y-5 mb-8">
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-[#050d1a] border border-[#1a2f4a] flex items-center justify-center flex-shrink-0">
                <Mail className="w-4 h-4 text-[#0ea5e9]" />
              </div>
              <div>
                <p className="text-[#475569] text-xs uppercase tracking-wider mb-0.5">Email</p>
                <a href="mailto:rigovivas71@gmail.com" className="text-white hover:text-[#0ea5e9] transition-colors text-sm">
                  rigovivas71@gmail.com
                </a>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-[#050d1a] border border-[#1a2f4a] flex items-center justify-center flex-shrink-0">
                <Shield className="w-4 h-4 text-[#10b981]" />
              </div>
              <div>
                <p className="text-[#475569] text-xs uppercase tracking-wider mb-0.5">Company</p>
                <p className="text-white text-sm">GMX Audit Control Center</p>
              </div>
            </div>
          </div>

          <a
            href="#lead-capture"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#0ea5e9] hover:bg-[#0284c7] text-white font-semibold rounded-lg transition-colors shadow-lg shadow-[#0ea5e9]/20"
          >
            Request Access
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </section>
  );
}

export default function Landing({ onNavigate }: LandingProps) {
  return (
    <>
      <HeroSection />
      <TrustBand />
      <WhatWeOffer />
      <PricingSection />
      <HowItWorks />
      <WhoThisIsFor />
      <FAQSection />
      <LeadCaptureSection />
      <ContactSection />
    </>
  );
}
