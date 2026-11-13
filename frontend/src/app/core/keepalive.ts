/**
 * A PUT that still goes out when the page is being left (`keepalive`), with the XSRF header Angular would add:
 * for the last change before a tab closes. Fire and forget.
 */
export function keepalivePut(url: string, body: unknown): void {
  const token = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1] ?? '';
  void fetch(url, {
    method: 'PUT',
    keepalive: true,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': decodeURIComponent(token) },
    body: JSON.stringify(body),
  });
}
