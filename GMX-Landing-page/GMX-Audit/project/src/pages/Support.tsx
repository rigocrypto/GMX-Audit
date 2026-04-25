import { ArrowLeft, Mail, Clock, HelpCircle, CreditCard, XCircle } from 'lucide-react';

interface SupportProps {
  onNavigate: (page: string) => void;
}

export default function Support({ onNavigate }: SupportProps) {
  const faqs = [
    {
      icon: <HelpCircle className="w-5 h-5 text-[#0ea5e9]" />,
      q: 'How do I get started with a plan?',
      a: 'Choose a plan on our pricing page and complete checkout via Stripe. For custom or Progression Pro engagements, use the contact form or email us directly to begin scoping.',
    },
    {
      icon: <CreditCard className="w-5 h-5 text-[#10b981]" />,
      q: 'How do I manage my billing?',
      a: 'Billing is managed through Stripe. You will receive a receipt via email after each charge. To update your payment method or view invoices, contact us and we will send you a Stripe billing portal link.',
    },
    {
      icon: <XCircle className="w-5 h-5 text-[#f59e0b]" />,
      q: 'How do I cancel my subscription?',
      a: 'Email contact@gmxaudit.com with your cancellation request. Cancellations take effect at the end of the current billing period. You retain full access until then.',
    },
    {
      icon: <HelpCircle className="w-5 h-5 text-[#0ea5e9]" />,
      q: 'What is included in my plan?',
      a: 'Each plan description on the pricing page details what is included. If you have questions about coverage or delivery specifics, reach out before purchasing and we will clarify.',
    },
    {
      icon: <HelpCircle className="w-5 h-5 text-[#10b981]" />,
      q: 'Can I upgrade or change my plan?',
      a: 'Yes. Contact us to discuss upgrading to a higher tier or transitioning to a custom engagement. We will coordinate any billing adjustments with you directly.',
    },
    {
      icon: <HelpCircle className="w-5 h-5 text-[#f59e0b]" />,
      q: 'I have a billing discrepancy. What do I do?',
      a: 'Email us within 30 days of the charge with your billing details. We will investigate and respond within one business day.',
    },
  ];

  return (
    <div className="min-h-screen bg-[#050d1a] pt-24 pb-20 px-4">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => onNavigate('home')}
          className="flex items-center gap-2 text-[#0ea5e9] hover:text-[#38bdf8] text-sm mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </button>

        <h1 className="text-3xl font-bold text-white mb-2">Support</h1>
        <p className="text-[#475569] text-sm mb-10">We are here to help with billing, service questions, and account management.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12">
          <div className="bg-[#0a1628] border border-[#1a2f4a] rounded-lg p-6">
            <Mail className="w-6 h-6 text-[#0ea5e9] mb-3" />
            <h3 className="text-white font-semibold mb-1">Email Support</h3>
            <a href="mailto:contact@gmxaudit.com" className="text-[#0ea5e9] hover:text-[#38bdf8] text-sm transition-colors">
              contact@gmxaudit.com
            </a>
          </div>
          <div className="bg-[#0a1628] border border-[#1a2f4a] rounded-lg p-6">
            <Clock className="w-6 h-6 text-[#10b981] mb-3" />
            <h3 className="text-white font-semibold mb-1">Response Time</h3>
            <p className="text-[#94a3b8] text-sm">We aim to respond within 1 business day for all support requests.</p>
          </div>
        </div>

        <h2 className="text-xl font-bold text-white mb-6">Common Questions</h2>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-[#0a1628] border border-[#1a2f4a] rounded-lg p-6">
              <div className="flex items-start gap-3 mb-2">
                {faq.icon}
                <h3 className="text-white font-semibold">{faq.q}</h3>
              </div>
              <p className="text-[#94a3b8] text-sm leading-relaxed ml-8">{faq.a}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 bg-[#0a1628] border border-[#1a2f4a] rounded-lg p-6">
          <h3 className="text-white font-semibold mb-2">Still need help?</h3>
          <p className="text-[#94a3b8] text-sm mb-4">
            Reach out directly and a member of our team will get back to you.
          </p>
          <a
            href="mailto:contact@gmxaudit.com"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0ea5e9] hover:bg-[#0284c7] text-white text-sm font-medium rounded transition-colors"
          >
            <Mail className="w-4 h-4" />
            Email Us
          </a>
        </div>
      </div>
    </div>
  );
}
