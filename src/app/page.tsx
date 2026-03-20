'use client';

import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import { useAuth } from '@clerk/nextjs';

export default function Home() {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const { getToken } = useAuth();

  // Save user profile on login — now with safe error handling
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken({ template: 'supabase' });
        if (!token) return;

        const res = await fetch('/api/profile/init', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          console.warn('profile/init failed:', res.status, txt);
        }
      } catch (e) {
        console.warn('profile/init error:', (e as any)?.message || e);
      }
    })();
  }, [getToken]);

  // ✅ ONLY THIS FUNCTION HAS BEEN UPDATED — EVERYTHING ELSE IS IDENTICAL
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResponse('Loading...');

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input }),
      });

      if (!res.ok) throw new Error('Failed');

      const data = await res.json();

      // If ask() routed to forms/suggest — show full JSON output
      if (data.mode === 'forms_suggest') {
        setResponse(JSON.stringify(data, null, 2));
      } else {
        // Normal chat behavior
        setResponse(data.result ?? JSON.stringify(data, null, 2));
      }
    } catch (err) {
      console.error(err);
      setResponse('Something went wrong. Try again later.');
    }
  }

  async function testFormFill() {
    try {
      const res = await fetch('/api/submit-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://www.w3schools.com/html/html_forms.asp',
          userData: {
            firstName: 'SurrenderlessUser',
            email: 'user@surrenderless.io',
            address: '123 Sunset Blvd',
          },
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const result = await res.json();
      alert(JSON.stringify(result, null, 2));
    } catch {
      alert('Something went wrong. Try again later.');
    }
  }

  return (
    <>
      <Header />
      <main className="p-4 max-w-xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Ask Surrenderless</h1>

        <form onSubmit={handleSubmit} className="mb-6">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your prompt here..."
            className="w-full border p-2 mb-2"
          />
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">
            Submit
          </button>
        </form>

        <pre className="bg-gray-100 p-2 rounded whitespace-pre-wrap">
          {response}
        </pre>

        <hr className="my-6" />

        <h2 className="text-xl font-semibold mb-2">Test GPT Form Fill</h2>
        <button onClick={testFormFill} className="bg-green-600 text-white px-4 py-2 rounded">
          Run Full Fill Flow
        </button>
      </main>
    </>
  );
}
