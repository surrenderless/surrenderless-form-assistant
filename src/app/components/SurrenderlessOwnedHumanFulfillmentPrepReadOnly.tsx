import Link from "next/link";
import Header from "@/app/components/Header";

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

export function SurrenderlessOwnedHumanFulfillmentPrepReadOnly({
  stepLabel,
}: {
  stepLabel: string;
}) {
  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/chat-ai" className="text-blue-600 hover:underline dark:text-blue-400">
            Return to chat
          </Link>
        </p>

        <div className={`mt-5 ${cardCls}`}>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
            Surrenderless is handling this step
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            Your <span className="font-medium">{stepLabel}</span> is owned by Surrenderless. Stay in
            chat for queued, in-progress, and completed updates while automation or operator
            fulfillment runs.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Continue case progress in chat — destination-prep DIY controls are not available for
            this step.
          </p>
        </div>
      </main>
    </>
  );
}
