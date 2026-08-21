import type { Capability } from "./types.ts";

/** Demo registry. Not a marketplace. Unknown names are treated as high-risk. */
export const CAPABILITIES: readonly Capability[] = [
  {
    id: "github.repository.read",
    provider: "github",
    name: "repository.read",
    risk: "low",
  },
  {
    id: "github.repository.delete",
    provider: "github",
    name: "repository.delete",
    risk: "high",
  },
];

export function capabilityRisk(name: string): "low" | "medium" | "high" {
  const key = name.trim().toLowerCase();
  const found = CAPABILITIES.find((item) => item.name === key);
  if (found) return found.risk;
  if (/write|delete|admin/i.test(key)) return "high";
  return "medium";
}

export function scopeIsRisky(scope: readonly string[]): boolean {
  return scope.some((item) => capabilityRisk(item) === "high");
}
