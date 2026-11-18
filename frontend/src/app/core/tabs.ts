/** The tab a key moves to in a WAI-ARIA tab list (arrows wrap around, Home and End), or null for any other key. */
export function tabAfterKey<T>(tabs: readonly T[], current: T, key: string): T | null {
  const i = tabs.indexOf(current);
  if (i < 0 || !tabs.length) return null;
  switch (key) {
    case 'ArrowRight':
      return tabs[(i + 1) % tabs.length];
    case 'ArrowLeft':
      return tabs[(i - 1 + tabs.length) % tabs.length];
    case 'Home':
      return tabs[0];
    case 'End':
      return tabs[tabs.length - 1];
    default:
      return null;
  }
}
