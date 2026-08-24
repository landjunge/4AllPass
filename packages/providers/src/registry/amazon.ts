import type { ProviderDefinition } from "../types.ts";

export const amazon: ProviderDefinition = {
  id: "amazon",
  name: "Amazon",
  category: "commerce",
  credentialKinds: ["web-login", "api"],
  domains: [
    { host: "amazon.com", match: "exact" },
    { host: "amazon.com", match: "subdomain" },
    { host: "amazon.de", match: "exact" },
    { host: "amazon.de", match: "subdomain" },
    { host: "amazon.co.uk", match: "exact" },
    { host: "amazon.co.uk", match: "subdomain" },
    { host: "amazonaws.com", match: "subdomain" },
  ],
};
