/**
 * Provider templates live in the client. FastAPI never indexes them.
 * Provider ≠ account ≠ credential (`docs/eight-week-agent-access.md`).
 */
import { emptyDraft, type EntryDraft, type EntryKind } from "./entries.ts";

export interface ProviderTemplate {
  id: string;
  name: string;
  kind: EntryKind;
  credentialType: string;
  capabilities: string[];
}

export const BUILTIN_TEMPLATES: ProviderTemplate[] = [
  {
    id: "github",
    name: "GitHub",
    kind: "api",
    credentialType: "personal_access_token",
    capabilities: ["repository.read", "repository.write", "issue.read"],
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "api",
    credentialType: "api_key",
    capabilities: ["api.read"],
  },
  {
    id: "stripe",
    name: "Stripe",
    kind: "api",
    credentialType: "api_key",
    capabilities: ["api.read"],
  },
  {
    id: "web",
    name: "Website",
    kind: "web",
    credentialType: "password",
    capabilities: ["login"],
  },
  {
    id: "sftp",
    name: "SSH/SFTP",
    kind: "sftp",
    credentialType: "password",
    capabilities: ["sftp.read", "sftp.write"],
  },
];

export function templateById(id: string): ProviderTemplate | undefined {
  return BUILTIN_TEMPLATES.find((item) => item.id === id);
}

export function applyTemplate(template: ProviderTemplate, account = "personal"): EntryDraft {
  const draft = emptyDraft(template.kind);
  return {
    ...draft,
    title: template.name,
    provider: template.name,
    account,
    capabilities: template.capabilities.join(" "),
    credentialType: template.credentialType,
  };
}

/**
 * Minimal YAML-shaped object (no extra parser). Accepts the plan's github example
 * as JSON or as indented `key: value` / list `- item` text.
 */
export function parseProviderTemplate(raw: string): ProviderTemplate {
  const text = raw.trim();
  if (!text) throw new Error("empty template");
  if (text.startsWith("{")) {
    const parsed = JSON.parse(text) as {
      id?: string;
      name?: string;
      kind?: EntryKind;
      credentialType?: string;
      capabilities?: string[];
      provider?: { id?: string; name?: string };
      credentials?: Array<{ type?: string }>;
    };
    const id = parsed.id ?? parsed.provider?.id;
    const name = parsed.name ?? parsed.provider?.name;
    if (!id || !name) throw new Error("template needs id and name");
    const kind: EntryKind =
      parsed.kind === "web" || parsed.kind === "sftp" || parsed.kind === "api" ? parsed.kind : "api";
    return {
      id,
      name,
      kind,
      credentialType: parsed.credentialType ?? parsed.credentials?.[0]?.type ?? "api_key",
      capabilities: parsed.capabilities ?? [],
    };
  }
  const id = text.match(/(?:^|\n)\s*id:\s*(\S+)/)?.[1];
  const name = text.match(/(?:^|\n)\s*name:\s*(.+)/)?.[1]?.trim();
  if (!id || !name) throw new Error("template needs id and name");
  const caps = [...text.matchAll(/^\s*-\s+([a-z0-9._:-]+)\s*$/gim)].map((match) => match[1]!);
  const cred = text.match(/type:\s*(\S+)/)?.[1] ?? "api_key";
  return { id, name, kind: "api", credentialType: cred, capabilities: caps };
}
