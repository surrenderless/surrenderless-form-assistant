import Header from "@/app/components/Header";

/** Shared Loading shell while prep-hub ownership is unresolved. */
export function SurrenderlessOwnedPrepHubLoading() {
  return (
    <>
      <Header />
      <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
        Loading…
      </main>
    </>
  );
}
