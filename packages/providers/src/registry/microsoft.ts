import type { ProviderDefinition } from "../types.ts";

export const microsoft: ProviderDefinition = {
  id: "microsoft",
  name: "Microsoft",
  category: "identity",
  credentialKinds: ["web-login", "oauth", "api"],
  domains: [
    { host: "microsoft.com", match: "exact" },
    { host: "microsoft.com", match: "subdomain" },
    { host: "live.com", match: "exact" },
    { host: "live.com", match: "subdomain" },
    { host: "outlook.com", match: "exact" },
    { host: "outlook.com", match: "subdomain" },
    { host: "office.com", match: "exact" },
    { host: "office.com", match: "subdomain" },
    { host: "office365.com", match: "subdomain" },
    { host: "microsoftonline.com", match: "subdomain" },
    { host: "login.microsoftonline.com", match: "login" },
    { host: "account.microsoft.com", match: "login" },
    { host: "xbox.com", match: "exact" },
    { host: "xbox.com", match: "subdomain" },
    { host: "azure.com", match: "exact" },
    { host: "azure.com", match: "subdomain" },
  ],
};
