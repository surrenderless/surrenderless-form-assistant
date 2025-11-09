import { clerkMiddleware } from "@clerk/nextjs/server";

export const middleware = clerkMiddleware();

export const config = {
  matcher: [
    '/((?!.*\\..*|_next).*)',
    '/',
    '/(api|trpc)(.*)',
  ],
};
