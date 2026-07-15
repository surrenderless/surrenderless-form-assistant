import Link from "next/link";
import Header from "@/app/components/Header";
import JusticeHubWorkspaceBody from "@/app/justice/JusticeHubWorkspaceBody";

export default function JusticeWorkspacePage() {
  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Consumer Justice workspace</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          Surrenderless helps you organize a consumer issue in chat into a structured case. After you approve next
          steps, Surrenderless can send outreach and complete supported filings for you — status stays in chat. Some
          destinations still need operators or outside portals when automation is unavailable.
        </p>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-500">
          Start in chat intake. Browse saved cases while signed in.
        </p>

        <JusticeHubWorkspaceBody />

        <p className="mt-8 text-sm">
          <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400">
            Home
          </Link>
        </p>
      </main>
    </>
  );
}
