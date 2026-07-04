import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mock real BBB complaint confirmation (internal testing)",
  robots: { index: false, follow: false },
};

export default function MockRealBbbComplainConfirmationPage() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div
        role="banner"
        className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      >
        <p className="font-semibold">Internal testing only</p>
        <p className="mt-1 max-w-3xl">
          Loopback stand-in for the BBB complaint confirmation step during Playwright E2E.
        </p>
      </div>

      <main className="mx-auto max-w-xl px-4 py-8 pb-16">
        <h1 className="text-2xl font-bold text-neutral-800">Complaint submitted</h1>
        <p className="mt-4 text-neutral-700">
          Thank you for submitting your complaint. Your complaint has been successfully submitted.
        </p>
        <p className="mt-2 text-sm text-neutral-600">Confirmation number: E2E-MOCK-12345</p>
      </main>
    </div>
  );
}
