export type AccessClientCode =
  | "missing_token"
  | "not_loopback"
  | "malformed_request"
  | "malformed_response"
  | "network"
  | "denied";

export class AccessClientError extends Error {
  readonly code: AccessClientCode;
  readonly reason: string | undefined;

  constructor(code: AccessClientCode, message: string, reason?: string) {
    super(message);
    this.name = "AccessClientError";
    this.code = code;
    this.reason = reason;
  }
}
