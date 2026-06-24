import type { Metadata } from "next";
import type { ReactNode } from "react";
import LegalDocumentShell from "@/app/components/LegalDocumentShell";
import {
  NO_AUTOMATED_FILING_DEFAULT_DISCLAIMER,
  NO_GUARANTEE_DISCLAIMER,
  NOT_LEGAL_ADVICE_DISCLAIMER,
} from "@/lib/legal/siteLegalLinks";

export const metadata: Metadata = {
  title: "Terms of Service | Surrenderless Form Assistant",
  description: "Terms governing use of Surrenderless Form Assistant.",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function TermsOfServicePage() {
  return (
    <LegalDocumentShell title="Terms of Service" lastUpdated="June 21, 2025">
      <Section title="Acceptance">
        <p>
          By accessing or using Surrenderless Form Assistant (&quot;Surrenderless,&quot; &quot;the service&quot;), you
          agree to these Terms of Service. If you do not agree, do not use the service.
        </p>
      </Section>

      <Section title="What the service does">
        <p>
          Surrenderless is a consumer case organization tool. It helps you capture intake information through chat and
          forms, organize evidence metadata, preview submission drafts, build action plans, prepare filing packets, and
          record manual or assisted filing activity.
        </p>
        <p>
          Unless a specific workflow is clearly labeled and enabled in your deployment, Surrenderless{" "}
          {NO_AUTOMATED_FILING_DEFAULT_DISCLAIMER}. Most regulator and business destinations are presented as manual
          preparation and copy-and-paste workflows where you submit information yourself on third-party sites.
        </p>
        <p>
          Optional assisted workflows may include same-origin mock practice forms and, when enabled in configuration,
          bounded browser automation for certain external complaint forms (such as the official Better Business Bureau
          complaint entry). Assisted features help populate forms you review; they do not replace your responsibility to
          verify accuracy before submission.
        </p>
      </Section>

      <Section title="Not legal advice">
        <p>
          {NOT_LEGAL_ADVICE_DISCLAIMER}. The service provides organizational tools, drafts, checklists, and automation
          assistance only. Nothing in the product creates an attorney-client relationship. For legal questions about
          your rights, remedies, or strategy, consult a qualified professional licensed in your jurisdiction.
        </p>
      </Section>

      <Section title="No guarantee of outcomes">
        <p>
          Surrenderless {NO_GUARANTEE_DISCLAIMER}. Responses from businesses, regulators, payment processors, or other
          third parties depend on their policies and your facts. We do not warrant that drafts, AI suggestions, or
          assisted form fills will be error-free, complete, or accepted.
        </p>
      </Section>

      <Section title="Your responsibilities">
        <p>You agree that you will:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Provide accurate information to the best of your knowledge when building cases and submissions;</li>
          <li>Review all drafts, AI output, and assisted form fills before submitting them anywhere;</li>
          <li>Use the service only for lawful consumer dispute organization and related personal purposes;</li>
          <li>Comply with the terms, policies, and submission rules of any third-party site where you file or dispute;</li>
          <li>Maintain the security of your account credentials and notify your authentication provider if compromised;</li>
          <li>
            Understand that evidence notes in the product store metadata only; you are responsible for retaining actual
            proof documents outside the app if needed.
          </li>
        </ul>
      </Section>

      <Section title="Prohibited misuse">
        <p>You may not use Surrenderless to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Submit false, misleading, or fraudulent complaints or filings;</li>
          <li>Harass, threaten, or defame others;</li>
          <li>Attempt to bypass authentication, ownership checks, rate limits, or URL allowlists;</li>
          <li>Probe, scan, or attack the service or connected infrastructure;</li>
          <li>Automate access except through features explicitly provided by the product;</li>
          <li>Use assisted submission features to target destinations outside approved allowlists;</li>
          <li>Violate applicable law or third-party rights.</li>
        </ul>
        <p>We may suspend or restrict access for conduct that risks the service, other users, or third parties.</p>
      </Section>

      <Section title="Assisted submission and third-party sites">
        <p>
          When you start an assisted workflow, you authorize the service to process your case-derived content through
          browser automation directed at permitted URLs. You remain the submitter of record on external sites unless
          those sites state otherwise.
        </p>
        <p>
          Third-party websites are not controlled by Surrenderless. We are not responsible for their availability,
          content, decisions, or data practices. Links and automation targets are provided for convenience only.
        </p>
      </Section>

      <Section title="Accounts and access">
        <p>
          Sign-in is provided through Clerk. You must have a valid account to use signed-in features. We may modify,
          suspend, or discontinue features with or without notice, subject to applicable law and any separate agreement
          governing your deployment.
        </p>
        <p>
          Optional payment checkout (Stripe) may be available in some deployments. Payment terms for paid features, if
          any, are presented at checkout and are in addition to these Terms.
        </p>
      </Section>

      <Section title="Disclaimers">
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER
          EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. WE DO NOT WARRANT UNINTERRUPTED OR ERROR-FREE OPERATION.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, SURRENDERLESS AND ITS OPERATORS WILL NOT BE LIABLE FOR ANY
          INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR
          OTHER INTANGIBLE LOSSES, ARISING FROM YOUR USE OF THE SERVICE.
        </p>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, OUR TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR
          RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US FOR THE SERVICE IN THE
          TWELVE MONTHS BEFORE THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS (USD $100), IF YOU PAID NOTHING.
        </p>
        <p>
          Some jurisdictions do not allow certain limitations; in those jurisdictions, our liability is limited to the
          fullest extent permitted by law.
        </p>
      </Section>

      <Section title="Termination">
        <p>
          You may stop using the service at any time. We may terminate or suspend your access if you violate these
          Terms, if required for security or legal compliance, or if we discontinue the service. Sections that by their
          nature should survive termination (including disclaimers, limitation of liability, and governing
          interpretations to the extent applicable) will survive.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>
          We may update these Terms as the product evolves. The &quot;Last updated&quot; date at the top indicates the
          latest version. Continued use after changes take effect constitutes acceptance of the revised Terms.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For questions about these Terms, contact us through the support or account contact options made available in
          your deployment or authentication provider account settings. This repository does not publish a dedicated legal
          mailing address or support inbox.
        </p>
      </Section>
    </LegalDocumentShell>
  );
}
