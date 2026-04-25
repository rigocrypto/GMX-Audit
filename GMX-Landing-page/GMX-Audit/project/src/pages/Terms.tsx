import { ArrowLeft } from 'lucide-react';

interface TermsProps {
  onNavigate: (page: string) => void;
}

export default function Terms({ onNavigate }: TermsProps) {
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

        <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
        <p className="text-[#475569] text-sm mb-10">Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

        <div className="prose prose-invert space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Services Description</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              GMX Audit Control Center provides digital security and engineering support services, including CI monitoring, regression coverage, security alerting, issue triage, artifact and evidence tracking, and audit-oriented operational support. Services are delivered remotely and digitally. All services are business-to-business (B2B) and intended for protocol teams, smart contract teams, infrastructure teams, and engineering operations teams.
            </p>
            <p className="text-[#94a3b8] leading-relaxed mt-3">
              One-time advisory engagements and custom scoped reviews are also available. The scope, deliverables, and delivery window for such engagements are confirmed prior to purchase or commencement of work.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. Billing and Payment Terms</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              Subscription plans are billed monthly. Payment is processed through Stripe, Inc. at the time of purchase or at the start of each billing period. By purchasing a subscription, you authorize us to charge your designated payment method on a recurring basis until the subscription is cancelled.
            </p>
            <p className="text-[#94a3b8] leading-relaxed mt-3">
              Custom and one-time engagements are invoiced per the terms agreed upon before work begins. Payment terms for custom engagements will be specified in a separate order confirmation or statement of work.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. Refunds</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              Monthly subscription fees are non-refundable except where required by applicable law. If you believe a billing error has occurred, contact us within 30 days of the charge at contact@gmxaudit.com and we will investigate promptly.
            </p>
            <p className="text-[#94a3b8] leading-relaxed mt-3">
              For one-time advisory engagements, refunds may be available if work has not commenced. Once an engagement has begun, fees for work already delivered are non-refundable. Disputes regarding one-time engagements should be raised within 14 days of delivery.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Delivery Model</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              All services are delivered digitally. Deliverables may include monitoring reports, alert notifications, regression summaries, CI analysis artifacts, and written findings documents. Delivery timelines for ongoing subscriptions are tied to the service cycle. For scoped engagements, delivery windows are specified before work begins. We will communicate delivery expectations clearly before any work is initiated.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Acceptable Use</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              You agree to use our services only for lawful purposes. You may not use our services to support illegal activity, to violate applicable laws or regulations, or to misrepresent your organization or its activities to us. Access to services is granted for the purchasing organization only and may not be resold or transferred without written authorization.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Cancellation</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              You may cancel your subscription at any time by contacting us at contact@gmxaudit.com. Cancellations take effect at the end of the current billing period. You will retain access to services through the end of the paid period. We reserve the right to terminate services for non-payment or violation of these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Limitation of Liability</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              To the maximum extent permitted by applicable law, GMX Audit Control Center shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or related to your use of our services, even if advised of the possibility of such damages. Our total liability to you for any claim arising out of or relating to these terms or our services shall not exceed the amount paid by you in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">8. Changes to Terms</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              We reserve the right to modify these terms at any time. Material changes will be communicated via email or through our website. Continued use of our services after the effective date of changes constitutes acceptance of the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">9. Contact</h2>
            <p className="text-[#94a3b8] leading-relaxed">
              For questions about these terms or your service agreement, contact us at:
            </p>
            <p className="text-[#0ea5e9] mt-2">contact@gmxaudit.com</p>
            <p className="text-[#94a3b8] mt-1">GMX Audit Control Center</p>
          </section>
        </div>
      </div>
    </div>
  );
}
