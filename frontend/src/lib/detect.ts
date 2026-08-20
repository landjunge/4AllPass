/**
 * Guess kind/provider from pasted text. Never grants access.
 * Auto-detect ≠ auto-approve (`docs/eight-week-agent-access.md` week 3).
 */
import { emptyDraft, type EntryDraft, type EntryKind } from "./entries.ts";

export interface DetectedCredential {
  kind: EntryKind;
  provider: string;
  title: string;
  password: string;
  url: string;
  host: string;
  port: string;
  protocol: string;
  capabilities: string;
  username: string;
  label: string;
}

function firstToken(text: string): string {
  return text.trim().split(/\s+/)[0] ?? "";
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function detectCredential(raw: string): DetectedCredential | null {
  const text = raw.trim();
  if (!text) return null;
  const token = firstToken(text);
  const blob = text.replace(/\s+/g, " ");

  if (/^ghp_[A-Za-z0-9_]{8,}$/i.test(token) || /^github_pat_[A-Za-z0-9_]{8,}$/i.test(token)) {
    return {
      kind: "api",
      provider: "GitHub",
      title: "GitHub",
      password: token,
      url: "https://api.github.com",
      host: "",
      port: "",
      protocol: "",
      capabilities: "repository.read",
      username: "",
      label: "GitHub personal access token · API",
    };
  }

  if (/^sk-(?:proj-)?[A-Za-z0-9_-]{16,}$/.test(token)) {
    return {
      kind: "api",
      provider: "OpenAI",
      title: "OpenAI",
      password: token,
      url: "https://api.openai.com",
      host: "",
      port: "",
      protocol: "",
      capabilities: "api.read",
      username: "",
      label: "OpenAI API key · API",
    };
  }

  if (/^sk_live_[A-Za-z0-9]{8,}$/.test(token) || /^sk_test_[A-Za-z0-9]{8,}$/.test(token)) {
    return {
      kind: "api",
      provider: "Stripe",
      title: "Stripe",
      password: token,
      url: "https://api.stripe.com",
      host: "",
      port: "",
      protocol: "",
      capabilities: "api.read",
      username: "",
      label: "Stripe API key · API",
    };
  }

  const sftp = blob.match(
    /(?:sftp:\/\/|ftp:\/\/)?([a-z0-9.-]+\.(?:example|local|com|net|org|io|dev)|ftp\.[a-z0-9.-]+)/i,
  );
  const looksFtp =
    /\b(sftp|ftp)\b/i.test(blob) ||
    /^ftp\./i.test(token) ||
    /^(?:sftp|ftp):\/\//i.test(token) ||
    /:22\b/.test(blob);
  if (looksFtp && sftp) {
    const host = sftp[1]!.replace(/^(?:sftp|ftp):\/\//i, "");
    const allLines = lines(text);
    const last = allLines.at(-1) ?? "";
    const password = last === token || last === host ? "" : last;
    const username =
      allLines.find(
        (line) =>
          line !== host &&
          line !== password &&
          line !== token &&
          !line.includes(host) &&
          !/^(?:sftp|ftp|password)$/i.test(line),
      ) ?? "";
    const isSftp = /\bsftp\b/i.test(blob) || /:22\b/.test(blob);
    return {
      kind: "sftp",
      provider: host,
      title: host,
      password,
      url: "",
      host,
      port: isSftp ? "22" : "21",
      protocol: isSftp ? "sftp" : "ftp",
      capabilities: "sftp.read",
      username,
      label: `FTP/SFTP · ${host}`,
    };
  }

  const http = blob.match(/https?:\/\/[^\s]+/i);
  if (http) {
    let host = "";
    let username = "";
    let password = "";
    let url = http[0]!;
    try {
      const parsed = new URL(http[0]!);
      host = parsed.hostname;
      username = decodeURIComponent(parsed.username);
      password = decodeURIComponent(parsed.password);
      url = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      host = "";
    }
    return {
      kind: "web",
      provider: host,
      title: host || "Website",
      password,
      url,
      host: "",
      port: "",
      protocol: "",
      capabilities: "login",
      username,
      label: `Web · ${host || url}`,
    };
  }

  return null;
}

/** Prefill a draft. Does not create a grant and does not save. */
export function draftFromDetection(detected: DetectedCredential): EntryDraft {
  const draft = emptyDraft(detected.kind);
  return {
    ...draft,
    title: detected.title,
    provider: detected.provider,
    password: detected.password || draft.password,
    url: detected.url,
    host: detected.host,
    port: detected.port || draft.port,
    protocol: detected.protocol || draft.protocol,
    capabilities: detected.capabilities || draft.capabilities,
    username: detected.username,
  };
}
