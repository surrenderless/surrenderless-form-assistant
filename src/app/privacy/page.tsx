import type { Metadata } from "next";
import type { ReactNode } from "react";
import LegalDocumentShell from "@/app/components/LegalDocumentShell";
import {
  NO_AUTOMATED_FILING_DEFAULT_DISCLAIMER,
  NO_GUARANTEE_DISCLAIMER,
  NOT_LEGAL_ADVICE_DISCLAIMER,
} from "@/lib/legal/siteLegalLinks";

export const metadata: Metadata = {
  title: "Privacy Policy | Surrenderless Form Assistant",
  description: "How Surrenderless Form Assistant collects, uses, and protects information.",
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
    <LegalDocumentShell title="Privacy Policy" lastUpdated="June 21, 2025">
      <Section title="Overview">
        <p>
          This Privacy Policy describes how Surrenderless Form Assistant (&quot;Surrenderless,&quot; &quot;we,&quot;
          &quot;us&quot;) handles information when you use this web application. Surrenderless helps you organize
          consumer issues into structured cases, prepare drafts and checklists, and record filing-related activity. It{" "}
          {NO_AUTOMATED_FILING_DEFAULT_DISCLAIMER} except where a clearly labeled, optional assisted workflow is
          enabled in your deployment.
        </p>
        <p>
          {NOT_LEGAL_ADVICE_DISCLAIMER}, and we {NO_GUARANTEE_DISCLAIMER}.
        </p>
      </Section>

      <Section title="Information we collect">
        <p>
          <strong>Account and authentication data.</strong> Sign-in is handled through Clerk. Clerk processes
          credentials and session information needed to authenticate you. We associate your activity in Surrenderless
          with your authenticated user identifier.
        </p>
        <p>
          <strong>Case and intake data.</strong> When you use Consumer Justice features, we store case-related
          information you provide or generate in the product, such as intake answers, case labels, timelines, client
          state, payment-dispute draft fields, and related workflow status. Some information may also be mirrored
          temporarily in your browser session or local storage to resume work on your device.
        </p>
        <p>
          <strong>Evidence metadata.</strong> The product lets you save proof notes as structured metadata (for example
          title, evidence type, optional date, and description). Surrenderless does not provide file upload storage for
          evidence attachments in the current product; you describe proof in text fields rather than uploading files
          through the app.
        </p>
        <p>
          <strong>Filing and handling records.</strong> You may record manual filing activity, handling requests, packet
          approvals, and similar workflow events tied to your cases.
        </p>
        <p>
          <strong>Automation and task logs.</strong> When you use assisted submission or form-analysis features, the
          service may store task logs, form field mappings, and related technical metadata needed to run or retry those
          workflows.
        </p>
        <p>
          <strong>Technical and security data.</strong> We use rate limiting and related safeguards that may process
          request metadata (such as identifiers derived from your session or IP address) to protect the service.
        </p>
      </Section>

      <Section title="How we use information">
        <p>We use the information above to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Provide sign-in, case persistence, and Consumer Justice workflow features;</li>
          <li>Generate drafts, previews, action plans, and checklists from your case data;</li>
          <li>Display your saved cases, evidence notes, filings, and timeline history when you are signed in;</li>
          <li>Run optional assisted browser workflows you initiate, and record their results in task logs;</li>
          <li>Protect the service through authentication checks, ownership validation, and rate limits;</li>
          <li>Improve reliability and troubleshoot errors in server logs where configured.</li>
        </ul>
        <p>We do not sell your personal information as part of the product behavior described in this repository.</p>
      </Section>

      <Section title="AI processing">
        <p>
          Surrenderless uses third-party AI services (OpenAI) for features such as conversational intake chat, optional
          AI-assisted submission draft text, field matching for assisted forms, and related decision assistance. When you
          use those features, relevant portions of your case context and prompts may be sent to the AI provider to
          generate responses.
        </p>
        <p>
          AI output is used to assist drafting and workflow suggestions only. It is not legal advice and may be
          incomplete or inaccurate. You are responsible for reviewing anything you rely on before submitting it anywhere.
        </p>
      </Section>

      <Section title="External submission assistance">
        <p>
          Some workflows help you prepare or assist with submitting information on external websites. In practice
          deployments this may include:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Same-origin mock practice forms (for example mock FTC or BBB practice pages) used for training and testing
            workflows;
          </li>
          <li>
            Optional real Better Business Bureau complaint autofill when explicitly enabled in the deployment
            configuration, which uses browser automation directed at the official BBB complaint URL;
          </li>
          <li>
            Manual copy-and-paste preparation pages for many other destinations, where Surrenderless prepares text for
            you to submit yourself on third-party sites.
          </li>
        </ul>
        <p>
          When assisted automation runs, form content derived from your case may be processed by browser automation
          infrastructure (local Playwright and/or a configured Browserless endpoint) and submitted only according to
          the workflow you start and the allowlisted destination URLs enforced by the service.
        </p>
        <p>
          Third-party sites have their own privacy practices. Information you submit on external regulator, business,
          or payment-platform sites is governed by those sites&apos; policies, not this one.
        </p>
      </Section>

      <Section title="Service providers">
        <p>Depending on how the application is deployed and which features you use, data may be processed by:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Clerk</strong> — authentication and session management;
          </li>
          <li>
            <strong>Supabase</strong> — database storage for cases, evidence metadata, filings, profiles, and task logs
            accessed through server-side API routes;
          </li>
          <li>
            <strong>OpenAI</strong> — AI-assisted intake, drafting, and form-matching features;
          </li>
          <li>
            <strong>Browserless</strong> (when configured) — remote browser automation for assisted form workflows;
          </li>
          <li>
            <strong>Upstash Redis</strong> (when configured) — rate limiting;
          </li>
          <li>
            <strong>Stripe</strong> (when configured) — payment checkout sessions if billing features are enabled in the
            deployment.
          </li>
        </ul>
        <p>
          These providers process data on our behalf only to deliver the features above. Their handling of data is also
          subject to their own terms and privacy policies.
        </p>
      </Section>

      <Section title="Security">
        <p>
          We use industry-standard web application practices available in this product, including authenticated API
          routes, case ownership checks, rate limiting on sensitive automation endpoints, and URL allowlisting for
          assisted external submission. No method of transmission or storage is completely secure; we cannot guarantee
          absolute security.
        </p>
        <p>
          Deployments may additionally use deployment-level access controls (for example HTTP basic authentication when
          configured). You are responsible for safeguarding your account credentials and devices.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          Case data is retained in the database while your account and cases remain active unless you take action
          available in the product. You can archive cases, which marks them with an archive timestamp and removes them
          from active case lists while retaining the stored record according to the deployment&apos;s database
          configuration.
        </p>
        <p>
          You may delete individual evidence metadata records through the evidence management features. Broader deletion
          of all account-linked data may require actions through your authentication provider and database
          administration for the deployment; specific retention schedules are not defined in the application code.
        </p>
        <p>
          Browser session and local storage mirrors on your device can be cleared by you through browser settings or by
          clearing site data.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          You choose what case information to enter. Many Consumer Justice features require sign-in. You can decline to
          use AI-assisted features where alternatives exist (for example deterministic draft previews). You can archive
          cases and manage evidence metadata within the product.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this Privacy Policy as the product changes. The &quot;Last updated&quot; date at the top of
          this page will reflect the latest revision. Continued use after changes become effective constitutes acceptance
          of the updated policy.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For privacy questions about Surrenderless Form Assistant, contact us through the support or account contact
          options made available in your deployment or authentication provider account settings. This repository does not
          publish a dedicated legal mailing address or privacy inbox.
        </p>
      </Section>
    </LegalDocumentShell>
  );
}
