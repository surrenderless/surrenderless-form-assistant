import type { ReactNode } from "react";
import Link from "next/link";
import Header from "@/app/components/Header";

type LegalDocumentShellProps = {
  title: string;
  lastUpdated: string;
  children: ReactNode;
};

export default function LegalDocumentShell({
  title,
  lastUpdated,
  children,
}: LegalDocumentShellProps) {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8 pb-16 sm:px-6">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400">
            Home
          </Link>
        </p>
        <h1 className="mt-4 text-3xl font-bold text-neutral-900 dark:text-neutral-100">{title}</h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Last updated: {lastUpdated}</p>
        <div className="prose-neutral mt-8 space-y-8 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          {children}
        </div>
      </main>
    </>
  );
}
