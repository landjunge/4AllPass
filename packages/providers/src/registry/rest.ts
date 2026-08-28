import type { CredentialKind, ProviderDefinition } from "../types.ts";

function web(
  id: string,
  name: string,
  hosts: string[],
  extra: DomainRuleLike[] = [],
  kinds: CredentialKind[] = ["web-login"],
): ProviderDefinition {
  const domains: ProviderDefinition["domains"] = [];
  for (const host of hosts) {
    domains.push({ host, match: "exact" }, { host, match: "subdomain" });
  }
  domains.push(...extra);
  return {
    id,
    name,
    category: "other",
    credentialKinds: kinds,
    domains,
  };
}

type DomainRuleLike = ProviderDefinition["domains"][number];

export const rest: ProviderDefinition[] = [
  web("gitlab", "GitLab", ["gitlab.com"]),
  web("bitbucket", "Bitbucket", ["bitbucket.org"]),
  web("facebook", "Facebook", ["facebook.com", "fb.com", "instagram.com", "whatsapp.com"]),
  web("x", "X", ["x.com", "twitter.com"]),
  web("linkedin", "LinkedIn", ["linkedin.com"]),
  web("discord", "Discord", ["discord.com", "discord.gg"]),
  web("slack", "Slack", ["slack.com"]),
  web("notion", "Notion", ["notion.so", "notion.com"]),
  web("dropbox", "Dropbox", ["dropbox.com"]),
  web("paypal", "PayPal", ["paypal.com"]),
  web("netflix", "Netflix", ["netflix.com"]),
  web("spotify", "Spotify", ["spotify.com"]),
  web("cloudflare", "Cloudflare", ["cloudflare.com"], [], ["web-login", "api"]),
  web("digitalocean", "DigitalOcean", ["digitalocean.com"]),
  web("openai", "OpenAI", ["openai.com", "chatgpt.com"], [], ["web-login", "api"]),
  web("stripe", "Stripe", ["stripe.com"], [], ["web-login", "api"]),
  web("bitwarden", "Bitwarden", ["bitwarden.com"]),
  {
    id: "1password",
    name: "1Password",
    category: "other",
    credentialKinds: ["web-login"],
    domains: [
      { host: "1password.com", match: "exact" },
      { host: "1password.com", match: "subdomain" },
    ],
  },
];
