import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const BYPASS = [/^\/_next\//, /^\/favicon\.ico$/, /^\/api\/healthz$/];

export const middleware = clerkMiddleware((auth, req) => {
  const url = new URL(req.url);
  if (BYPASS.some((r) => r.test(url.pathname))) return NextResponse.next();

  const pw = process.env.DEPLOY_PASSWORD;

  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Basic ")) {
    try {
      const decoded = atob(h.split(" ")[1] || "");
      const pass = decoded.split(":").slice(1).join(":");
      if (pass === pw) return NextResponse.next();
    } catch {}
  }

  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Private Site"' },
  });
});

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
