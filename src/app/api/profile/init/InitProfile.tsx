'use client';
import { useUser } from '@clerk/nextjs';

export default function InitProfile() {
  const { user, isLoaded } = useUser();

  const init = async () => {
    if (!user) return;
    const res = await fetch('/api/profile/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: user.fullName || user.username || 'No Name',
        email: user.primaryEmailAddress?.emailAddress || 'No Email',
      }),
    });
    const json = await res.json();
    console.log('init profile →', res.status, json);
  };

  if (!isLoaded) return null;
  return (
    <button onClick={init} className="p-2 rounded bg-green-600 text-white">
      Initialize Profile
    </button>
  );
}
