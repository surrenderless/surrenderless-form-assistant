import Link from "next/link";
import { PRIVACY_POLICY_PATH, TERMS_OF_SERVICE_PATH } from "@/lib/legal/siteLegalLinks";

export default function SiteFooter() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-neutral-500 dark:text-neutral-500">
          Surrenderless Form Assistant — consumer case organization and draft preparation.
        </p>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            href={PRIVACY_POLICY_PATH}
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Privacy Policy
          </Link>
          <Link
            href={TERMS_OF_SERVICE_PATH}
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Terms of Service
          </Link>
        </nav>
      </div>
    </footer>
  );
}
