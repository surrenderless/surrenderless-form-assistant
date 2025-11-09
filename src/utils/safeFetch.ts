export async function safeFetch<T=any>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let msg = "Request failed";
    try { const j = await res.json(); msg = j?.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
