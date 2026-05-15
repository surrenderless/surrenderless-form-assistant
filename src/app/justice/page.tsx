import Link from "next/link";
import Header from "@/app/components/Header";

const cardCls =
  "block rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-md shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] transition hover:border-blue-200/80 hover:shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/[0.06] dark:hover:border-blue-800/50";

export default function JusticeWorkspacePage() {
  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Consumer Justice workspace</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          Surrenderless helps you organize a consumer issue into a structured action plan. This version prepares
          drafts, checklists, and records you can use yourself. It does not file or submit complaints automatically to
          regulators, courts, or companies.
        </p>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-500">
          Recommended: start with chat intake. Use the form intake if you prefer the full structured form. You can
          also open your plan or browse cases you saved while signed in.
        </p>

        <ul className="mt-8 space-y-3">
          <li>
            <Link href="/justice/chat" className={`${cardCls} text-left`}>
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Start with chat intake
              </span>
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                Answer step-by-step questions to build your case.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/justice/plan" className={`${cardCls} text-left`}>
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Continue current action plan
              </span>
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                Open your plan when you already have a case in this browser — or follow prompts there to start or
                resume.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/justice/intake" className={`${cardCls} text-left`}>
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Start with form intake
              </span>
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                Fill in the structured intake form.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/justice/cases" className={`${cardCls} text-left`}>
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Saved cases</span>
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                Open a case you saved while signed in.
              </span>
            </Link>
          </li>
        </ul>

        <p className="mt-8 text-sm">
          <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400">
            Home
          </Link>
        </p>
      </main>
    </>
  );
}
