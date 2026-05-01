import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mock complaint form (internal testing)",
  robots: { index: false, follow: false },
};

export default function MockFtcComplaintPage() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div
        role="banner"
        className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      >
        <p className="font-semibold">Internal testing only</p>
        <p className="mt-1 max-w-3xl">
          This page is a non-official practice form for product development. It is not affiliated with,
          endorsed by, or connected to the Federal Trade Commission (FTC) or any government agency.
          Do not treat submissions here as real complaints.
        </p>
      </div>

      <main className="mx-auto max-w-2xl px-4 py-8 pb-16">
        <h1 className="text-2xl font-bold text-neutral-800">Practice complaint form</h1>
        <p className="mt-2 text-sm text-neutral-600">
          For automation and QA. Fields use stable <code className="rounded bg-neutral-200 px-1">name</code> and{" "}
          <code className="rounded bg-neutral-200 px-1">id</code> attributes for testing.
        </p>

        <form
          className="mt-8 space-y-8"
          method="get"
          action="/mock/ftc-complaint"
          id="mock_ftc_complaint_form"
        >
          <fieldset className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <legend className="px-1 text-lg font-semibold text-neutral-800">1. Issue type</legend>
            <div className="mt-4">
              <label htmlFor="issue_type" className="block text-sm font-medium text-neutral-700">
                What kind of issue is this?
              </label>
              <select
                id="issue_type"
                name="issue_type"
                className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-neutral-900"
                defaultValue=""
              >
                <option value="" disabled>
                  Select an issue type
                </option>
                <option value="billing">Billing or charges</option>
                <option value="delivery">Delivery or shipping</option>
                <option value="refund">Refund or return</option>
                <option value="privacy">Privacy or data</option>
                <option value="other">Other</option>
              </select>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <legend className="px-1 text-lg font-semibold text-neutral-800">2. Company / seller</legend>
            <div className="mt-4 space-y-4">
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
              <div>
                <label htmlFor="company_website" className="block text-sm font-medium text-neutral-700">
                  Website (optional)
                </label>
                <input
                  type="url"
                  id="company_website"
                  name="company_website"
                  placeholder="https://"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <legend className="px-1 text-lg font-semibold text-neutral-800">3. Complaint description</legend>
            <div className="mt-4">
              <label htmlFor="complaint_description" className="block text-sm font-medium text-neutral-700">
                Describe what happened
              </label>
              <textarea
                id="complaint_description"
                name="complaint_description"
                rows={6}
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
              />
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <legend className="px-1 text-lg font-semibold text-neutral-800">4. Dates</legend>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="incident_date" className="block text-sm font-medium text-neutral-700">
                  When did the problem happen?
                </label>
                <input
                  type="date"
                  id="incident_date"
                  name="incident_date"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
                />
              </div>
              <div>
                <label htmlFor="order_date" className="block text-sm font-medium text-neutral-700">
                  Order or purchase date (optional)
                </label>
                <input
                  type="date"
                  id="order_date"
                  name="order_date"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <legend className="px-1 text-lg font-semibold text-neutral-800">5. Contact info</legend>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="contact_full_name" className="block text-sm font-medium text-neutral-700">
                  Full name
                </label>
                <input
                  type="text"
                  id="contact_full_name"
                  name="contact_full_name"
                  autoComplete="name"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
                />
              </div>
              <div>
                <label htmlFor="contact_email" className="block text-sm font-medium text-neutral-700">
                  Email
                </label>
                <input
                  type="email"
                  id="contact_email"
                  name="contact_email"
                  autoComplete="email"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
                />
              </div>
              <div>
                <label htmlFor="contact_phone" className="block text-sm font-medium text-neutral-700">
                  Phone
                </label>
                <input
                  type="tel"
                  id="contact_phone"
                  name="contact_phone"
                  autoComplete="tel"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="contact_address_line1" className="block text-sm font-medium text-neutral-700">
                  Street address
                </label>
                <input
                  type="text"
                  id="contact_address_line1"
                  name="contact_address_line1"
                  autoComplete="address-line1"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
                />
              </div>
              <div>
                <label htmlFor="contact_city" className="block text-sm font-medium text-neutral-700">
                  City
                </label>
                <input
                  type="text"
                  id="contact_city"
                  name="contact_city"
                  autoComplete="address-level2"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
                />
              </div>
              <div>
                <label htmlFor="contact_state" className="block text-sm font-medium text-neutral-700">
                  State
                </label>
                <input
                  type="text"
                  id="contact_state"
                  name="contact_state"
                  autoComplete="address-level1"
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-neutral-900"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="contact_zip" className="block text-sm font-medium text-neutral-700">
                  ZIP code
                </label>
                <input
                  type="text"
                  id="contact_zip"
                  name="contact_zip"
                  autoComplete="postal-code"
                  className="mt-1 w-full max-w-xs rounded border border-neutral-300 px-3 py-2 text-neutral-900"
                />
              </div>
            </div>
          </fieldset>

          <div className="flex flex-col gap-2 border-t border-neutral-200 pt-6">
            <button
              type="submit"
              className="rounded-lg bg-neutral-800 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-neutral-700"
            >
              Submit mock complaint (testing only)
            </button>
            <p className="text-xs text-neutral-500">
              This button only runs a browser GET to this same practice page with your field values in the URL. It does
              not send data to any government site.
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}
