import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mock real BBB complain wizard (internal testing)",
  robots: { index: false, follow: false },
};

export default function MockRealBbbComplainPage() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div
        role="banner"
        className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      >
        <p className="font-semibold">Internal testing only</p>
        <p className="mt-1 max-w-3xl">
          Loopback stand-in for the BBB complain entry step during Playwright E2E. Not affiliated with
          the Better Business Bureau.
        </p>
      </div>

      <main className="mx-auto max-w-xl px-4 py-8 pb-16">
        <h1 className="text-2xl font-bold text-neutral-800">File a complaint with BBB</h1>
        <p className="mt-2 text-sm text-neutral-600">Practice complain entry page for bounded submit E2E.</p>

        <form
          className="mt-8 space-y-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
          method="get"
          action="/mock/real-bbb-complain/confirmation"
        >
          <div>
            <label htmlFor="company_name" className="block text-sm font-medium text-neutral-700">
              Company or seller name
            </label>
            <input
              type="text"
              id="company_name"
              name="company_name"
              autoComplete="organization"
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
            />
          </div>

          <button
            type="submit"
            id="continue_btn"
            className="rounded-lg bg-neutral-800 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            Continue
          </button>
        </form>
      </main>
    </div>
  );
}
