const TOKEN_SHAPES = [
  /ghp_[A-Za-z0-9_]+/g,
  /github_pat_[A-Za-z0-9_]+/g,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /"access_token"\s*:\s*"[^"]*"/g,
];

/** Strip grant material from a string. Does not claim to catch every secret shape. */
export function redactSecrets(text: string, extra: string[] = []): string {
  let out = text;
  for (const value of extra) {
    if (value.length >= 4) out = out.split(value).join("[redacted]");
  }
  out = out.replace(TOKEN_SHAPES[0]!, "[redacted]");
  out = out.replace(TOKEN_SHAPES[1]!, "[redacted]");
  out = out.replace(TOKEN_SHAPES[2]!, "[redacted]");
  out = out.replace(TOKEN_SHAPES[3]!, '"access_token":"[redacted]"');
  return out;
}

export function redactGrant(result: {
  status: string;
  accessToken?: string;
  expiresIn?: number;
  reason?: string;
}): Record<string, unknown> {
  if (result.status === "approved") {
    return {
      status: "approved",
      access_token: "(redacted in this client)",
      expires_in: result.expiresIn ?? 0,
    };
  }
  return { status: "denied", reason: result.reason ?? "denied" };
}
