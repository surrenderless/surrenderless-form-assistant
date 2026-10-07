import type { Metadata } from "next";
import type { ReactNode } from "react";
import LegalDocumentShell from "@/app/components/LegalDocumentShell";
import {
  LEGAL_ENTITY_NAME,
  NO_GUARANTEE_DISCLAIMER,
  NOT_LEGAL_ADVICE_DISCLAIMER,
  SUPPORT_EMAIL,
} from "@/lib/legal/siteLegalLinks";

export const metadata: Metadata = {
  title: "Privacy Policy | Surrenderless",
  description: "How Surrenderless collects, uses, shares, and protects information.",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentShell title="Privacy Policy" lastUpdated="October 7, 2026">
      <Section title="Overview">
        <p>
          This Privacy Policy explains how {LEGAL_ENTITY_NAME} (&quot;Surrenderless,&quot; &quot;we,&quot;
          &quot;us&quot;) handles information when you use Surrenderless. Surrenderless helps you pursue consumer
          complaints and disputes through chat: we organize your case, prepare drafts, and, once you pay for a case and
          approve a step, send messages and file complaints on your behalf.
        </p>
        <p>
          {NOT_LEGAL_ADVICE_DISCLAIMER}, and we {NO_GUARANTEE_DISCLAIMER}.
        </p>
      </Section>

      <Section title="Information we collect">
        <p>
          <strong>Account information.</strong> Your sign-in details and email address, handled through our
          authentication provider.
        </p>
        <p>
          <strong>Case information.</strong> What you tell us in chat about your problem, such as the company involved,
          what happened, dates, amounts, your contact details, and the outcome you want, plus the drafts, approvals,
          timeline, and status of each case.
        </p>
        <p>
          <strong>Evidence files.</strong> Receipts, screenshots, and other documents you upload. Files are stored
          privately and are not publicly accessible.
        </p>
        <p>
          <strong>Payment information.</strong> Payment is processed by Stripe. We receive confirmation that a case was
          paid and related payment status (such as refunds or disputes); we do not receive or store your full card number.
        </p>
        <p>
          <strong>Delivery information.</strong> Records of messages we send for you, including whether they were
          delivered, bounced, or marked as spam.
        </p>
        <p>
          <strong>Technical information.</strong> Request metadata such as IP-derived identifiers used for security and
          rate limiting, and basic page-view analytics.
        </p>
      </Section>

      <Section title="How we use information">
        <ul className="list-disc space-y-2 pl-5">
          <li>To run the chat, organize your case, and prepare drafts for your review;</li>
          <li>To carry out the steps you approve, such as emailing a company or filing a complaint;</li>
          <li>To track responses, remind you of follow-ups, and tell you about progress on your case;</li>
          <li>To process payments and handle refund requests;</li>
          <li>To protect the service, your account, and other users;</li>
          <li>To troubleshoot problems and improve reliability.</li>
        </ul>
        <p>We do not sell your personal information.</p>
      </Section>

      <Section title="When we share information">
        <p>
          <strong>With the recipients you approve.</strong> When you approve a step, the relevant case details and
          evidence are sent to that recipient, such as the merchant, your bank or card issuer, or a regulator or
          organization like the CFPB, FCC, FTC, DOT, BBB, or your state attorney general. Your email address may be
          included so they can reply to you directly. Once received, the information is handled under that
          recipient&apos;s own policies.
        </p>
        <p>
          <strong>With our team.</strong> Surrenderless team members can see the case details and evidence they need to
          complete the steps you approve and to review responses.
        </p>
        <p>
          <strong>With service providers</strong> who process data for us only to run the service:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Clerk</strong> — sign-in and account management;
          </li>
          <li>
            <strong>Supabase</strong> — database and private file storage for your cases and evidence;
          </li>
          <li>
            <strong>OpenAI</strong> — AI processing for the chat and draft preparation;
          </li>
          <li>
            <strong>Resend</strong> — sending emails on your behalf and to you;
          </li>
          <li>
            <strong>Stripe</strong> — payments;
          </li>
          <li>
            <strong>Vercel</strong> — hosting and basic analytics;
          </li>
          <li>
            <strong>Upstash</strong> — rate limiting;
          </li>
          <li>
            <strong>Browserless</strong> — browser automation, if a filing step is completed through automation.
          </li>
        </ul>
        <p>We may also disclose information when required by law or to protect rights and safety.</p>
      </Section>

      <Section title="AI processing">
        <p>
          The chat and draft preparation use OpenAI. Relevant parts of your case are sent to OpenAI to generate
          responses. AI output can be incomplete or wrong, which is why you review each draft before approving it.
        </p>
      </Section>

      <Section title="Security">
        <p>
          We use authenticated access, per-account ownership checks on every case, private file storage, and rate
          limiting. No method of transmission or storage is completely secure, and we cannot guarantee absolute
          security. Please keep your account credentials safe.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          We keep case information while your account is active and as needed to complete, track, and support your
          cases, including after a case is archived. To ask us to delete evidence files, your account, or associated
          case data, email {SUPPORT_EMAIL}. We may keep records we are required to
          keep by law, such as payment records. Information already sent to a recipient on your behalf cannot be
          recalled.
        </p>
        <p>
          Some in-progress chat data is also saved in your browser so you can pick up where you left off. You can clear
          it through your browser settings.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You decide what to share and which steps to approve. You can ask us to stop future steps on a case at any time.
          You can request access to, correction of, or deletion of your information by emailing {SUPPORT_EMAIL}.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this Privacy Policy as the service changes. The &quot;Last updated&quot; date at the top of this
          page shows the latest version. Continued use after changes take effect means you accept the updated policy.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Privacy questions and requests can be sent to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 hover:underline dark:text-blue-400">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalDocumentShell>
  );
}
