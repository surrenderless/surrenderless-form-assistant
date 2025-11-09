import { UserButton, SignInButton, SignedIn, SignedOut } from '@clerk/nextjs';

export default function Header() {
  return (
    <header className="flex justify-between p-4 border-b">
      <h1 className="text-xl font-semibold">Surrenderless</h1>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
      <SignedOut>
        <SignInButton />
      </SignedOut>
    </header>
  );
}
