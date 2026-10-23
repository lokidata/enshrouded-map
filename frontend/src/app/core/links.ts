/** Link carrying a one-time token in the URL fragment: never sent to a server nor written in its logs. */
export const hashLink = (kind: 'invite' | 'reset', token: string): string =>
  `${location.origin}${location.pathname}#${kind}=${token}`;

/** Reads (and removes from the address bar) the token of an invitation or reset link. */
export function takeHashToken(): { kind: 'invite' | 'reset'; token: string } | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const kind = params.has('invite') ? 'invite' : params.has('reset') ? 'reset' : null;
  if (!kind) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return { kind, token: params.get(kind) ?? '' };
}

/** Local time (HH:MM) of a UTC timestamp sent by the API without a time zone. */
export const timeOf = (utc: string): string =>
  new Date(utc + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // clipboard blocked: the field selects its content on focus
  }
}
