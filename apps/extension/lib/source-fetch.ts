/**
 * Shared plumbing for fetching an external source file's text on demand —
 * used by the Sources panel (page-context fetch) and the background's
 * FETCH_SOURCE handler (host-permission fetch fallback).
 */

/**
 * Reads a response body as text, stopping at `limit` characters so a click
 * on a pathological resource can never balloon memory. Cancels the stream
 * once the cap is hit.
 */
export async function readBodyCapped(
  response: Response,
  limit: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return text.length > limit
      ? { text: text.slice(0, limit), truncated: true }
      : { text, truncated: false };
  }

  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text, truncated: false };
    text += decoder.decode(value, { stream: true });
    if (text.length >= limit) {
      await reader.cancel().catch(() => undefined);
      return { text: text.slice(0, limit), truncated: true };
    }
  }
}
