import type { BrowserContext, Page } from "@playwright/test";

export interface VirtualAuthenticatorOptions {
  hasPrf: boolean;
  hasLargeBlob: boolean;
}

/**
 * Attach a Chrome virtual authenticator to this context.
 *
 * `hasPrf` / `hasLargeBlob` are what decides which fallback rank the client
 * provisions, so the same test can be run against a PRF-capable authenticator,
 * a largeBlob-only one, and one that supports neither.
 */
export async function addVirtualAuthenticator(
  context: BrowserContext,
  page: Page,
  options: VirtualAuthenticatorOptions,
): Promise<string> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: options.hasPrf,
      hasLargeBlob: options.hasLargeBlob,
      // The authenticator reports a verified user, as a platform authenticator
      // does after Touch ID / Windows Hello.
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
}
