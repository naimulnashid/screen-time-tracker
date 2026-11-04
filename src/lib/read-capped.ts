/**
 * A request body, read with a byte ceiling enforced WHILE it arrives.
 *
 * `request.text()`, `json()` and `arrayBuffer()` buffer the whole body before
 * anything can look at its size, and a chunked upload declares no
 * Content-Length to refuse up front. So every route that reads a body reads
 * it through here, and an oversized one is cancelled the moment it passes
 * `max` bytes -- never held in full (audit SEC-001). Bytes, not characters:
 * a `text().length` check let 4,096 characters of multi-byte text through at
 * up to four times the size.
 *
 * Returns null when the body is too large; the caller answers 413.
 */
export async function readCapped(request: Request, max: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The body as JSON under `max` bytes: `too-large`, `bad-json`, or the value. */
export async function readCappedJson(
  request: Request,
  max: number,
): Promise<{ ok: true; value: unknown } | { ok: false; error: 'too-large' | 'bad-json' }> {
  const body = await readCapped(request, max);
  if (!body) return { ok: false, error: 'too-large' };
  try {
    return { ok: true, value: JSON.parse(body.toString('utf8')) };
  } catch {
    return { ok: false, error: 'bad-json' };
  }
}
