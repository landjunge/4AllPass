import type { VaultEntry } from "../../types/vault.ts";

export type EntryCategory = "bank" | "email" | "shopping" | "health" | "social" | "other";

/** Higher weight = more damage if that secret is weak, reused, or leaked. */
export const CATEGORY_WEIGHT: Record<EntryCategory, number> = {
  bank: 5,
  email: 4,
  health: 4,
  shopping: 3,
  social: 2,
  other: 1,
};

const BANK = /\b(sparkasse|volksbank|commerzbank|deutsche.?bank|ing-diba|n26|paypal|wise|revolut|stripe|klarna|visa|mastercard|amex)\b/i;
const EMAIL = /\b(gmail|googlemail|outlook|hotmail|yahoo|gmx|web\.de|proton|icloud|fastmail)\b/i;
const SHOP = /\b(amazon|ebay|otto|zalando|shopify|etsy|paypal)\b/i;
const HEALTH = /\b(doctors|arzt|apotheke|pharmacy|kranken|health|klinik|hospital)\b/i;
const SOCIAL = /\b(facebook|instagram|twitter|x\.com|linkedin|tiktok|threads|mastodon|discord|reddit|whatsapp|telegram)\b/i;

export function classifyEntry(entry: VaultEntry): EntryCategory {
  const blob = `${entry.domain} ${entry.host} ${entry.url} ${entry.provider} ${entry.title}`;
  if (BANK.test(blob)) return "bank";
  if (EMAIL.test(blob)) return "email";
  if (HEALTH.test(blob)) return "health";
  if (SHOP.test(blob)) return "shopping";
  if (SOCIAL.test(blob)) return "social";
  return "other";
}
