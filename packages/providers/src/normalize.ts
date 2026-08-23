/** Hostname only. Never compare raw URLs. */

export function normalizeDomain(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let hostname = "";
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    hostname = url.hostname;
  } catch {
    hostname = raw.split("/")[0]?.split("?")[0]?.split("#")[0] ?? "";
    const cut = hostname.indexOf(":");
    if (cut > 0) hostname = hostname.slice(0, cut);
  }
  hostname = hostname.trim().toLowerCase();
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);
  if (!hostname || hostname === "localhost") return hostname || null;
  if (!hostname.includes(".")) return hostname;
  return hostname;
}

/** Last two labels, e.g. shop.example.de → example.de. Not a provider id. */
export function possibleRegistrable(domain: string): string | null {
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  return `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
}
