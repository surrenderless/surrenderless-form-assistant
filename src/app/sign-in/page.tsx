// src/app/sign-in/page.tsx
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { SignIn } from '@clerk/nextjs';

export default function Page() {
  return (
    <main className="flex items-center justify-center min-h-screen p-6">
      <SignIn />
    </main>
  );
}
