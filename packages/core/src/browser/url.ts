/**
 * Address-bar input → URL, browser-omnibox style. An explicit `http(s)://` is
 * kept as-is; loopback hosts and bare dot-less `host:port` get `http://` (dev
 * servers speak http); a dotted domain — optionally with a port and/or path —
 * gets `https://`; anything else becomes a Google search. Empty input returns
 * `''` so the caller can substitute its home page.
 *
 * The dot-less-host rule is why typing `localhost` (or `localhost:3000`) now
 * navigates instead of searching — the old rule required a dot in the host.
 */
export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (s === '') return '';
  if (/^https?:\/\//i.test(s)) return s;
  // Loopback hosts (localhost, 127.0.0.1, 0.0.0.0, ::1), optional port + path.
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/.*)?$/i.test(s)) return `http://${s}`;
  // A bare dot-less host with a port — a dev hostname like `api:8080`.
  if (/^[^\s./]+:\d{2,5}(\/.*)?$/.test(s)) return `http://${s}`;
  // A dotted domain, optional port and/or path (example.com, sub.host.co:8443/x).
  if (/^[^\s/]+(\.[^\s/]+)+(:\d+)?(\/.*)?$/.test(s)) return `https://${s}`;
  // Not URL-shaped — treat it as a search query.
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}
