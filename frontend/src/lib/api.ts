export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}${url}`);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
