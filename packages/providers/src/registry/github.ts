import type { ProviderDefinition } from "../types.ts";

export const github: ProviderDefinition = {
  id: "github",
  name: "GitHub",
  category: "developer",
  credentialKinds: ["web-login", "api"],
  domains: [
    { host: "github.com", match: "exact" },
    { host: "github.com", match: "subdomain" },
    { host: "githubassets.com", match: "subdomain" },
  ],
};
