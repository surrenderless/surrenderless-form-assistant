import Link from 'next/link';
import { UserButton, SignInButton, SignedIn, SignedOut } from '@clerk/nextjs';

export default function Header() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 p-4 border-b">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Surrenderless</h1>
        <Link href="/justice/intake" className="text-sm text-blue-600 hover:underline">
          Consumer case
        </Link>
      </div>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
      <SignedOut>
        <SignInButton />
      </SignedOut>
    </header>
  );
}
