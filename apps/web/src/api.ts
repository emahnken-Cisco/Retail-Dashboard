export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Do not send Content-Type: application/json with no body — Fastify rejects empty JSON bodies (400).
  const headers = new Headers(init?.headers);
  const body = init?.body;
  const hasBody = body != null && body !== "";
  if (
    hasBody &&
    !(typeof FormData !== "undefined" && body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const o = err as { error?: string; hint?: string };
    const msg = o.error ?? res.statusText;
    throw new Error(o.hint ? `${msg} — ${o.hint}` : msg);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
