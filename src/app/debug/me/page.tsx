"use client";
import { useUser } from "@clerk/nextjs";

export default function Me() {
  const { isLoaded, isSignedIn, user } = useUser();
  if (!isLoaded) return <div>loading…</div>;
  if (!isSignedIn) return <div>NOT SIGNED IN</div>;
  return (
    <pre style={{padding:16,background:"#111",color:"#eee",borderRadius:8}}>
{JSON.stringify({
  userId: user.id,
  email: user.primaryEmailAddress?.emailAddress,
  role: (user.publicMetadata as any)?.role ?? null
}, null, 2)}
    </pre>
  );
}
