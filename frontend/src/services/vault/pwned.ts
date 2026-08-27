/**
 * Have I Been Pwned range API (k-anonymity). Sends only the first 5 hex
 * chars of SHA-1(password). The 4AllPass server never sees the secret or hash.
 */
const HIBP_RANGE = "https://api.pwnedpasswords.com/range/";

export async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export type RangeLookup = (prefix: string) => Promise<string>;

export async function hibpRangeLookup(prefix: string): Promise<string> {
  const response = await fetch(`${HIBP_RANGE}${prefix}`, {
    headers: { "Add-Padding": "true" },
  });
  if (!response.ok) throw new Error(`hibp ${response.status}`);
  return response.text();
}

export async function pwnedCount(password: string, lookup: RangeLookup = hibpRangeLookup): Promise<number> {
  if (!password) return 0;
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const body = await lookup(prefix);
  for (const line of body.split(/\r?\n/)) {
    const [found, count] = line.trim().split(":");
    if (found === suffix) return Number(count) || 1;
  }
  return 0;
}
