// src/middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

const BYPASS = [/^\/_next\//, /^\/favicon\.ico$/, /^\/api\/healthz$/];

// Create the Clerk-powered middleware function once
const runClerk = clerkMiddleware();

export function middleware(req: NextRequest) {
  const url = new URL(req.url);

  // Skip gating for assets/health
  if (BYPASS.some((r) => r.test(url.pathname))) {
    return runClerk(req);
  }

  // If no password set, just proceed to Clerk
  const pw = process.env.DEPLOY_PASSWORD;
  if (!pw) {
    return runClerk(req);
  }

  // Basic Auth gate
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Basic ")) {
    try {
      const decoded = atob(h.slice(6).trim());
      const pass = decoded.split(":").slice(1).join(":");
      if (pass === pw) {
        return runClerk(req);
      }
    } catch {
      // fall through to 401
    }
  }

  // Prompt for credentials
  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Private Site"' },
  });
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
