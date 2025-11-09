'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';

export default function Dashboard() {
  const { user } = useUser();
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleUSPSSubmit() {
    try {
      const res = await fetch('/api/tasks/usps-submit', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to submit USPS task');
      const data = await res.json();
      alert(data.message || 'Done!');
    } catch {
      alert('Something went wrong.');
    }
  }

  // Step 3 polling — only when signed in; stop after 2 failures
  useEffect(() => {
    if (!user) return;

    let failures = 0;
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/task-logs');
        if (!res.ok) throw new Error('Failed to fetch task logs');
        const data = await res.json();
        setLogs(data.logs || []);
        setError(null);
        failures = 0; // reset on success
      } catch {
        failures += 1;
        setError('⚠️ Could not load task logs. Please try again later.');
        if (failures >= 2) clearInterval(id); // stop noisy retries
      }
    }, 3000);

    return () => clearInterval(id);
  }, [user]);

  function rerunTask(id: string) {
    alert(`Re-running task ${id}...`);
  }

  return (
    <main className="p-6">
      <h2 className="text-2xl font-bold mb-4">Welcome, {user?.firstName}</h2>

      <div className="space-y-4">
        <button
          onClick={handleUSPSSubmit}
          className="p-2 bg-green-600 text-white rounded w-full"
        >
          Submit USPS Address Change
        </button>

        <button className="p-2 bg-blue-600 text-white rounded w-full">
          View Past Submissions
        </button>

        <button className="p-2 bg-yellow-600 text-white rounded w-full">
          Manage My Info
        </button>
      </div>

      <h3 className="text-xl font-semibold mt-6">Live Task Logs</h3>
      <div className="mt-2">
        {error && <p className="text-red-600">{error}</p>}
        {logs.map((log: any) => (
          <div key={log.id} className="border p-4 my-2 bg-white shadow">
            <p><strong>{log.task_type}</strong> - {log.status}</p>
            <p>{log.result_summary}</p>
            <ul className="text-sm mt-2">
              {(log.steps || []).map((step: any, i: number) => (
                <li key={i}>✅ {step.step} @ {new Date(step.time).toLocaleTimeString()}</li>
              ))}
            </ul>
            {log.status === 'success' && (
              <button
                onClick={() => rerunTask(log.id)}
                className="mt-2 bg-blue-600 text-white px-2 py-1 rounded"
              >
                Re-run This Task
              </button>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
