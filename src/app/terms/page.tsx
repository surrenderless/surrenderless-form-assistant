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
  title: "Terms of Service | Surrenderless",
  description: "Terms governing use of Surrenderless.",
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
    <LegalDocumentShell title="Terms of Service" lastUpdated="October 7, 2026">
      <Section title="Acceptance">
        <p>
          Surrenderless (&quot;Surrenderless,&quot; &quot;we,&quot; &quot;us,&quot; &quot;the service&quot;) is operated
          by {LEGAL_ENTITY_NAME}. By accessing or using the service, you agree to these Terms of Service. If you do not
          agree, do not use the service.
        </p>
      </Section>

      <Section title="What the service does">
        <p>
          Surrenderless helps you pursue a consumer complaint or dispute through chat. You describe your problem, upload
          supporting evidence, and review the drafts we prepare. After you pay for a case and approve a step,
          Surrenderless carries out that step for you and keeps you updated in chat.
        </p>
        <p>Depending on your case, approved steps may include:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Emailing the merchant or company about your problem;</li>
          <li>Emailing or contacting your bank or card issuer about a payment dispute;</li>
          <li>
            Filing a complaint with a regulator or organization such as the Consumer Financial Protection Bureau (CFPB),
            Federal Communications Commission (FCC), Federal Trade Commission (FTC), U.S. Department of Transportation
            (DOT), Better Business Bureau (BBB), or your state attorney general;
          </li>
          <li>Sending a demand letter to the company.</li>
        </ul>
        <p>
          Some steps are sent automatically by email from Surrenderless. Others are completed by a Surrenderless team
          member on the destination&apos;s official website. After a step is completed, we track responses, remind you
          of follow-up dates, and may suggest the next step if the problem is not resolved.
        </p>
      </Section>

      <Section title="Not legal advice">
        <p>
          {NOT_LEGAL_ADVICE_DISCLAIMER}. Surrenderless is not a law firm, and our team members are not acting as your
          lawyers. Nothing in the service creates an attorney-client relationship. For legal questions about
          your rights, remedies, or strategy, consult a qualified professional licensed in your jurisdiction.
        </p>
      </Section>

      <Section title="No guarantee of outcomes">
        <p>
          Surrenderless {NO_GUARANTEE_DISCLAIMER}. Responses from businesses, regulators, payment processors, or other
          third parties depend on their policies and your facts. We do not warrant that drafts, AI suggestions, or
          submissions will be error-free, complete, or accepted.
        </p>
      </Section>

      <Section title="Your responsibilities">
        <p>You agree that you will:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Provide accurate information to the best of your knowledge when building cases and submissions;</li>
          <li>Review each draft before you approve it, and tell us in chat if anything is wrong;</li>
          <li>Use the service only for lawful consumer dispute organization and related personal purposes;</li>
          <li>Only upload evidence you have the right to share;</li>
          <li>Keep your own copies of important documents;</li>
          <li>Keep your account credentials secure and tell us promptly if you believe your account was compromised.</li>
        </ul>
      </Section>

      <Section title="Prohibited misuse">
        <p>You may not use Surrenderless to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Submit false, misleading, or fraudulent complaints or filings;</li>
          <li>Harass, threaten, or defame others;</li>
          <li>Access another person&apos;s cases or attempt to bypass security or rate limits;</li>
          <li>Probe, scan, or attack the service or connected infrastructure;</li>
          <li>Access the service through automated means other than features we provide;</li>
          <li>Violate applicable law or third-party rights.</li>
        </ul>
        <p>We may suspend or restrict access for conduct that risks the service, other users, or third parties.</p>
      </Section>

      <Section title="Your authorization">
        <p>
          When you approve a step for a paid case, you authorize {LEGAL_ENTITY_NAME} to act on your behalf for that
          step. This includes sending the approved message or submitting the approved complaint on your behalf, using the information and
          evidence you provided for that case, and listing your contact email so the recipient can reply to you
          directly. We do not take a step you have not approved.
        </p>
        <p>
          You confirm that the information you provide is true to the best of your knowledge. A complaint or dispute is
          made about your own experience, and some destinations may contact you directly or require you to confirm or
          sign something yourself. If that happens, we will tell you in chat.
        </p>
        <p>
          You can ask us to stop future steps at any time by telling us in chat or emailing {SUPPORT_EMAIL}. Steps already
          submitted before you ask may not be reversible.
        </p>
      </Section>

      <Section title="Third-party sites and recipients">
        <p>
          Businesses, banks, regulators, and other recipients are not controlled by Surrenderless. We are not
          responsible for their availability, decisions, or data practices.
        </p>
      </Section>

      <Section title="Payment and refunds">
        <p>
          Surrenderless charges a one-time fee per case before we begin handling it. The exact fee
          and currency are shown to you before checkout, and payment is collected once, through Stripe Checkout, when
          you complete it. The fee is per case and does not cover any other case.
        </p>
        <p>
          Payment does not guarantee a successful outcome. Payment is final once checkout completes. Changing your
          mind, withdrawing, or asking to stop after payment does not qualify for a refund. You may stop future
          actions on your case at any time, but actions already submitted or queued before you stop may not be
          reversible.
        </p>
        <p>Refunds are limited to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Duplicate charges for the same case;</li>
          <li>
            A verified Surrenderless technical failure that prevents completion of the paid handling and cannot be
            fixed or completed through a supported alternative; or
          </li>
          <li>Refunds required by applicable law.</li>
        </ul>
        <p>
          To request a refund under this policy, email {SUPPORT_EMAIL} with your account email and the case it concerns.
        </p>
      </Section>

      <Section title="Accounts and access">
        <p>
          You need an account to use the service. We may modify, suspend, or discontinue features with or without
          notice, subject to applicable law.
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
          Questions about these Terms, refund requests, and requests to stop work on a case can be sent to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-600 hover:underline dark:text-blue-400">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalDocumentShell>
  );
}
