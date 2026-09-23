/**
 * Constant-time string compare for webhook secrets and similar tokens.
 * Works in Workers (no Node `crypto.timingSafeEqual` dependency).
 *
 * Both inputs are hashed to fixed-length SHA-256 digests so unequal lengths do
 * not short-circuit the comparison.
 */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let out = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    out |= bytesA[i]! ^ bytesB[i]!;
  }
  return out === 0;
}
