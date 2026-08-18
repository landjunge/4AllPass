import type { DeviceUnlockMechanism } from "./types.ts";

export class DeviceUnlockError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** WebAuthn is not usable here (no API, no authenticator, user cancelled). */
export class WebAuthnUnavailableError extends DeviceUnlockError {}

/** The authenticator returned no usable `prf.results.first`. */
export class PrfUnavailableError extends DeviceUnlockError {
  constructor(message = "authenticator returned no usable prf.results.first") {
    super(message);
  }
}

/** The assertion succeeded but the UV flag was not set. Never release key material. */
export class UserVerificationError extends DeviceUnlockError {
  constructor(message = "assertion completed without user verification") {
    super(message);
  }
}

/**
 * No mechanism could unlock this device. The caller must offer master-password
 * unlock, which stays available on every device (webauthn-prf.md §5).
 */
export class DeviceUnlockUnavailableError extends DeviceUnlockError {
  readonly attempted: ReadonlyArray<{ mechanism: DeviceUnlockMechanism | "none"; reason: string }>;

  constructor(attempted: ReadonlyArray<{ mechanism: DeviceUnlockMechanism | "none"; reason: string }>) {
    const detail = attempted.map((a) => `${a.mechanism}: ${a.reason}`).join("; ");
    super(`device unlock unavailable, use the master password (${detail || "no mechanism configured"})`);
    this.attempted = attempted;
  }
}
