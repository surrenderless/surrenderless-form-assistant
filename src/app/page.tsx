'use client';

import { useState } from 'react';

export default function Home() {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');

  async function handleSubmit(e: any) {
    e.preventDefault();
    setResponse('Loading...');
    const res = await fetch('/api/ask', {
      method: 'POST',
      body: JSON.stringify({ prompt: input }),
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    setResponse(data.result);
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-bold mb-4">Surrenderless AI</h1>
      <form onSubmit={handleSubmit} className="w-full max-w-md">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What do you want to do?"
          className="w-full p-2 border border-gray-300 rounded"
        />
        <button
          type="submit"
          className="mt-2 w-full bg-black text-white p-2 rounded"
        >
          Submit
        </button>
      </form>
      <div className="mt-6 w-full max-w-md bg-gray-100 p-4 rounded">
        {response}
      </div>
    </main>
  );
}
