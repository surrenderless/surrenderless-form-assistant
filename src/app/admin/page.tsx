"use client";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Log = {
  id: string; user_id: string; task_type: string; status: string;
  result_summary: string | null; created_at: string;
};

export default function AdminPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const isAdmin = (user?.publicMetadata as any)?.role === "admin";

  useEffect(() => { if (isLoaded && !isAdmin) router.replace("/"); }, [isLoaded, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/admin/users").then(r=>r.json()).then(d=>setUsers(d.users||[])).catch(()=>setUsers([]));
    fetch("/api/admin/task-logs").then(r=>r.json()).then(d=>setLogs(d.logs||[])).catch(()=>setLogs([]));
  }, [isAdmin]);

  if (!isLoaded) return <div>Loading…</div>;
  if (!isAdmin) return null;

  return (
    <main className="p-6 space-y-8">
      <h1 className="text-2xl font-bold">Admin</h1>

      {/* Users */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Users</h2>
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left p-2">Email</th>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u:any)=>(
                <tr key={u.id} className="border-t">
                  <td className="p-2">{u.email}</td>
                  <td className="p-2">{u.name ?? "-"}</td>
                  <td className="p-2">{u.created_at ? new Date(u.created_at).toLocaleString() : "-"}</td>
                </tr>
              ))}
              {users.length===0 && <tr><td className="p-2" colSpan={3}>No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Task Logs */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Task Logs (latest 50)</h2>
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left p-2">Time</th>
                <th className="text-left p-2">User</th>
                <th className="text-left p-2">Task</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l=>(
                <tr key={l.id} className="border-t">
                  <td className="p-2">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="p-2">{l.user_id}</td>
                  <td className="p-2">{l.task_type}</td>
                  <td className="p-2">{l.status}</td>
                  <td className="p-2">{l.result_summary ?? "-"}</td>
                </tr>
              ))}
              {logs.length===0 && <tr><td className="p-2" colSpan={5}>No logs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
