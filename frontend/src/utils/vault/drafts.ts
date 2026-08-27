import { emptyDraft, generatePassword, type EntryDraft, type EntryKind, type VaultEntry } from "../../lib/entries.ts";
import { parseOtpauth } from "../../lib/totp.ts";

export function createNewDraft(kind: EntryKind = "web"): EntryDraft {
  return { ...emptyDraft(kind), password: generatePassword() };
}

export function draftFromEntry(entry: VaultEntry): EntryDraft {
  return {
    kind: entry.kind,
    title: entry.title,
    provider: entry.provider,
    account: entry.account,
    username: entry.username,
    password: entry.password,
    url: entry.url,
    host: entry.host,
    port: entry.port,
    protocol: entry.protocol,
    capabilities: entry.capabilities,
    credentialType: entry.credentialType,
    notes: entry.notes,
    totpSecret: entry.totpSecret,
    domain: entry.domain,
    providerId: entry.providerId,
    providerConfidence: entry.providerConfidence,
    providerMatchType: entry.providerMatchType,
    favorite: entry.favorite,
  };
}

export function applyKindToDraft(draft: EntryDraft, kind: EntryKind): EntryDraft {
  return {
    ...draft,
    kind,
    port: kind === "sftp" && !draft.port ? "22" : draft.port,
    protocol: kind === "sftp" && !draft.protocol ? "sftp" : draft.protocol,
    capabilities: kind === "api" && !draft.capabilities ? "repository.read" : draft.capabilities,
    credentialType: kind === "api" ? "api_key" : "password",
  };
}

export function applyTotpInput(draft: EntryDraft, value: string): EntryDraft {
  const parsed = parseOtpauth(value);
  if (parsed) {
    return {
      ...draft,
      totpSecret: parsed.secret,
      title: draft.title || parsed.issuer || parsed.account,
      username: draft.username || parsed.account,
    };
  }
  return { ...draft, totpSecret: value };
}

export function draftHasAdvancedFields(entry: VaultEntry): boolean {
  return Boolean(entry.totpSecret || entry.capabilities || entry.provider || entry.account);
}
