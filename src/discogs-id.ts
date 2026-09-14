/** A release ID or a Discogs release URL, never a master, artist or first number in arbitrary text. */
export function parseDiscogsReleaseId(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (/^[1-9][0-9]*$/.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['discogs.com', 'www.discogs.com'].includes(url.hostname)
      || url.username || url.password || url.port) return null;
    const match = /^\/(?:[a-z]{2}\/)?release\/([1-9][0-9]*)(?:-[^/]*)?\/?$/.exec(url.pathname);
    return match ? parseDiscogsReleaseId(match[1]) : null;
  } catch { return null; }
}
