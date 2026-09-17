export async function readLimitedBody(request, max) {
  const tooLarge = () => Object.assign(new Error('Upload is too large.'), { status: 413 });
  if (Number(request.headers.get('content-length')) > max) throw tooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel(); throw tooLarge(); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
