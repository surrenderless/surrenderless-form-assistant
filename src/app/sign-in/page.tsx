"use client";
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <main className="flex items-center justify-center h-screen">
      <SignIn path="/sign-in" routing="path" />
    </main>
  );
}
      