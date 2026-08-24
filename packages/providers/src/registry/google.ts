import type { ProviderDefinition } from "../types.ts";

export const google: ProviderDefinition = {
  id: "google",
  name: "Google",
  category: "identity",
  credentialKinds: ["web-login", "oauth", "api"],
  domains: [
    { host: "google.com", match: "exact" },
    { host: "google.com", match: "subdomain" },
    { host: "gmail.com", match: "exact" },
    { host: "youtube.com", match: "exact" },
    { host: "youtube.com", match: "subdomain" },
    { host: "googleapis.com", match: "subdomain" },
    { host: "accounts.google.com", match: "login" },
  ],
};
