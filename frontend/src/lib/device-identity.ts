/**
 * Stable per-browser-profile identity.
 *
 * The device id is bound into the device envelope AAD and into the DWK, so it
 * must survive reloads and must not be shared between profiles. It is a random
 * local value: it says nothing about the machine.
 */
import { bytesToHex, randomBytes } from "@4allpass/crypto";

const DEVICE_ID_KEY = "4allpass.deviceId";

export function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = `dev_${bytesToHex(randomBytes(12))}`;
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export function forgetDeviceId(): void {
  localStorage.removeItem(DEVICE_ID_KEY);
}

/** Coarse label only. The server stores this summary, never the raw header. */
export function describeDevice(): { label: string; platform: string; userAgentSummary: string } {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua) && !/Chromium/.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const platform = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown";
  return {
    label: `${browser} on ${platform}`,
    platform,
    userAgentSummary: `${browser} on ${platform}`,
  };
}

/** The WebAuthn RP ID for this deployment: the origin's hostname. */
export function rpId(): string {
  return window.location.hostname;
}
