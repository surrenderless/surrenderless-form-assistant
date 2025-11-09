import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasPublishable: !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    hasSecret: !!process.env.CLERK_SECRET_KEY,
    afterSignIn: process.env.CLERK_AFTER_SIGN_IN_URL ?? null,
    afterSignUp: process.env.CLERK_AFTER_SIGN_UP_URL ?? null,
    nodeEnv: process.env.NODE_ENV,
  });
}
