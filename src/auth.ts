import { createHash, timingSafeEqual } from "node:crypto";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function matches(provided: string, expectedHash: Buffer): boolean {
  return expectedHash.length === 32 && timingSafeEqual(sha256(provided), expectedHash);
}

/**
 * Check the x-api-key header. Returns who the key belongs to, or null if rejected.
 *
 * - WHISPERFLOW_KEYS: comma-separated "name:sha256hex" pairs (generate with
 *   `npm run new-key -- <name>`). Netlify only holds fingerprints, and each
 *   person can be revoked by deleting their entry.
 * - WHISPERFLOW_SECRET: legacy single shared secret, still accepted.
 * - Neither set: the endpoint is open, as before.
 */
export function checkKey(
  provided: string | null,
  getEnv: (key: string) => string | undefined
): string | null {
  const keys = getEnv("WHISPERFLOW_KEYS")?.trim();
  const secret = getEnv("WHISPERFLOW_SECRET");
  if (!keys && !secret) return "open";
  if (!provided) return null;

  for (const entry of (keys ?? "").split(",")) {
    const [name, hash] = entry.trim().split(":");
    if (name && hash && matches(provided, Buffer.from(hash.trim(), "hex"))) return name;
  }

  if (secret && matches(provided, sha256(secret))) return "shared-secret";
  return null;
}
