import { NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

const BYPASS = [/^\/_next\//, /^\/favicon\.ico$/, /^\/api\/healthz$/];

export function middleware(req: Request) {
  const url = new URL(req.url);
  if (BYPASS.some((r) => r.test(url.pathname))) return NextResponse.next();

  const pw = process.env.DEPLOY_PASSWORD;
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Basic ")) {
    try {
      const decoded = atob(h.split(" ")[1] || "");
      const pass = decoded.split(":").slice(1).join(":");
      if (pass === pw) return clerkMiddleware() as any;
    } catch {}
  }

  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Private Site"' },
  });
}

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
