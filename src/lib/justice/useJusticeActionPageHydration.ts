"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchAndHydrateLatestJusticeCase,
  readValidLocalJusticeIntake,
} from "@/lib/justice/hydrateActiveCaseFromServer";
import type { JusticeIntake } from "@/lib/justice/types";

export type JusticeActionPageHydration = {
  status: "loading" | "ready" | "redirecting" | "needs_sign_in";
  intake: JusticeIntake | null;
};

/**
 * For justice action routes: prefer valid local intake; if absent and signed in, resume latest case from GET /api/justice/cases.
 * If absent and signed out, status is `needs_sign_in` (no redirect — pages show a resume prompt).
 */
export function useJusticeActionPageHydration(): JusticeActionPageHydration {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<JusticeActionPageHydration>({
    status: "loading",
    intake: null,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!isLoaded) {
      setState({ status: "loading", intake: null });
      return;
    }

    const local = readValidLocalJusticeIntake();
    if (local) {
      setState({ status: "ready", intake: local });
      return;
    }

    if (!isSignedIn) {
      setState({ status: "needs_sign_in", intake: null });
      return;
    }

    const ac = new AbortController();
    setState({ status: "loading", intake: null });

    void (async () => {
      try {
        const hydrated = await fetchAndHydrateLatestJusticeCase(ac.signal);
        if (ac.signal.aborted) return;
        if (!hydrated) {
          setState({ status: "redirecting", intake: null });
          router.replace("/justice/intake");
          return;
        }
        setState({ status: "ready", intake: hydrated });
      } catch {
        if (ac.signal.aborted) return;
        setState({ status: "redirecting", intake: null });
        router.replace("/justice/intake");
      }
    })();

    return () => ac.abort();
  }, [isLoaded, isSignedIn, router]);

  return state;
}
