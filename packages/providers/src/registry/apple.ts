import type { ProviderDefinition } from "../types.ts";

export const apple: ProviderDefinition = {
  id: "apple",
  name: "Apple",
  category: "identity",
  credentialKinds: ["web-login", "oauth"],
  domains: [
    { host: "apple.com", match: "exact" },
    { host: "apple.com", match: "subdomain" },
    { host: "icloud.com", match: "exact" },
    { host: "icloud.com", match: "subdomain" },
    { host: "appleid.apple.com", match: "login" },
  ],
};
