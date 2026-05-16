"use client";

import { SignInButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Header from "@/app/components/Header";
import { clearLocalJusticeSession } from "@/lib/justice/clearLocalJusticeSession";

export default function JusticeActionResumeSignInPrompt() {
  const router = useRouter();

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Sign in to resume your case</h1>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          Saved cases are tied to your account. Sign in to continue, or start a new case.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SignInButton mode="modal">
            <button
              type="button"
              className="rounded-xl bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-neutral-900 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-white"
            >
              Sign in
            </button>
          </SignInButton>
          <button
            type="button"
            onClick={() => {
              clearLocalJusticeSession();
              router.push("/justice");
            }}
            className="inline-flex justify-center rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            Start new case
          </button>
        </div>
      </main>
    </>
  );
}
