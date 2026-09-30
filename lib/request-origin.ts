/**
 * Browser Fetch Metadata describes the caller's relationship to the public URL,
 * even when a reverse proxy gives Next.js an internal request URL.
 * Browsers cannot set Sec-Fetch-Site from application JavaScript.
 */
export function isAllowedRequestOrigin(
  headers: Headers,
  requestUrl: string,
): boolean {
  const origin = headers.get('origin');
  const site = headers.get('sec-fetch-site');

  // Explicit browser cross-origin calls remain blocked, including subdomains.
  if (site === 'cross-site' || site === 'same-site') return false;
  if (!origin) return true; // Non-browser clients, e.g. curl.

  let caller: URL;
  try {
    caller = new URL(origin);
    if (
      !['http:', 'https:'].includes(caller.protocol) ||
      caller.username ||
      caller.password ||
      caller.pathname !== '/' ||
      caller.search ||
      caller.hash
    )
      return false;
  } catch {
    return false;
  }

  if (site === 'same-origin') return true;

  // Fallback for clients without Fetch Metadata: compare actual public origins.
  const internal = new URL(requestUrl);
  if (caller.origin === internal.origin) return true;
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  const protocol =
    headers.get('x-forwarded-proto') ?? internal.protocol.slice(0, -1);
  // Accept a single authority, never ambiguous lists or URL path/userinfo input.
  if (
    !host ||
    !/^[a-z0-9.\-:\[\]]+$/i.test(host) ||
    !['http', 'https'].includes(protocol)
  )
    return false;
  try {
    return caller.origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}
