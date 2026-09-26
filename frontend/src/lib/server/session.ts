/**
 * Server-side (Next route handlers) view of the browser session. The login token lives in the HttpOnly `asc_session`
 * cookie the .NET API sets, which the browser also sends to this Next server (cookies are per host, not per port);
 * a Bearer header is still honoured for non-browser callers.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5058";
const COOKIE_NAME = "asc_session";
/** Same header the browser app adds to every request (lib/api.ts AUTH_HEADERS): a cross-site page cannot send it. */
const CSRF_HEADER = "x-requested-with";

export function getSessionToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) return auth.replace(/^Bearer\s+/i, "") || null;
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join("=")) || null;
  }
  return null;
}

/** Checks the caller's own session against the .NET backend. A cookie-only caller must also carry the custom header. */
export async function isAuthorized(request: Request): Promise<boolean> {
  const token = getSessionToken(request);
  if (!token) return false;
  if (!request.headers.get("authorization") && !request.headers.get(CSRF_HEADER)) return false;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok;
  } catch {
    return false;
  }
}
