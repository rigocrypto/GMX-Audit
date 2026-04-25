import { ArrowLeft } from 'lucide-react';

interface PrivacyProps {
  onNavigate: (page: string) => void;
}

export default function Privacy({ onNavigate }: PrivacyProps) {
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

        <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-[#475569] text-sm mb-10">Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

        <div className="prose prose-invert space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Information We Collect</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              We collect information you provide directly to us, including your email address and optional company or team name when you submit our lead capture form or request access. We also collect information automatically when you use our services, including usage data, log data, and device information necessary to deliver and improve our services.
            </p>
            <p className="text-[#94a3b8] leading-relaxed mt-3">
              For paid plan purchases, payment information is collected and processed by Stripe, Inc. We do not store full card numbers or sensitive payment credentials on our systems.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. How We Use Your Information</h2>
            <p className="text-[#94a3b8] leading-relaxed">We use the information we collect to:</p>
            <ul className="list-disc list-inside text-[#94a3b8] space-y-2 mt-2 ml-4">
              <li>Deliver and manage the services you have purchased or requested</li>
              <li>Communicate with you about your account, scope, and service delivery</li>
              <li>Send product updates, availability notices, and service-related communications</li>
              <li>Process payments and manage billing through Stripe</li>
              <li>Comply with legal obligations and resolve disputes</li>
              <li>Improve and develop our service offerings</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. Payment Processing</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              All payment transactions are processed by Stripe, Inc., a third-party payment processor. When you purchase a plan, you will be redirected to Stripe's secure checkout environment. Your payment information is subject to Stripe's Privacy Policy, available at stripe.com/privacy. We receive confirmation of successful payments but do not store raw payment credentials.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Data Retention</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              We retain your contact and engagement information for as long as necessary to provide services, comply with legal obligations, and resolve disputes. Lead capture data (email and company name) is retained until you request deletion or until it is no longer operationally relevant. You may request deletion of your data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Sharing of Information</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              We do not sell, trade, or rent your personal information to third parties. We may share information with service providers who assist us in operating our business (including Stripe for payment processing), subject to confidentiality obligations. We may also disclose information when required by law or to protect the rights, property, or safety of our business or users.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Your Rights</h2>
            <p className="text-[#94a3b8] leading-relaxed">You have the right to:</p>
            <ul className="list-disc list-inside text-[#94a3b8] space-y-2 mt-2 ml-4">
              <li>Access the personal information we hold about you</li>
              <li>Request correction of inaccurate information</li>
              <li>Request deletion of your personal data, subject to legal retention requirements</li>
              <li>Opt out of non-essential communications at any time</li>
            </ul>
            <p className="text-[#94a3b8] leading-relaxed mt-3">
              To exercise any of these rights, contact us at the email below.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Security</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              We implement appropriate technical and organizational measures to protect your information against unauthorized access, alteration, disclosure, or destruction. No method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">8. Contact</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              For privacy-related requests or questions, contact us at:
            </p>
            <p className="text-[#0ea5e9] mt-2">contact@gmxaudit.com</p>
            <p className="text-[#94a3b8] mt-1">GMX Audit Control Center</p>
          </section>
        </div>
      </div>
    </div>
  );
}
