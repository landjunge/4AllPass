import assert from "node:assert/strict";
import { test } from "node:test";

import { prfCapabilityState, type WebviewWebauthnCaps } from "./webauthnCapabilities.ts";

function caps(partial: Partial<WebviewWebauthnCaps>): WebviewWebauthnCaps {
  return {
    publicKeyCredential: true,
    credentialsCreate: true,
    platformAuthenticator: null,
    prf: null,
    ...partial,
  };
}

test("prfCapabilityState is available only when the client reported PRF", () => {
  assert.equal(prfCapabilityState(caps({ prf: true })), "available");
});

test("prfCapabilityState is unavailable when PRF is false or the API is missing", () => {
  assert.equal(prfCapabilityState(caps({ prf: false })), "unavailable");
  assert.equal(prfCapabilityState(caps({ publicKeyCredential: false, prf: null })), "unavailable");
  assert.equal(prfCapabilityState(caps({ credentialsCreate: false, prf: null })), "unavailable");
});

test("prfCapabilityState treats a WebAuthn API without a PRF report as unconfirmed", () => {
  // Desktop WKWebView: PublicKeyCredential exists, getClientCapabilities is absent.
  assert.equal(prfCapabilityState(caps({ prf: null })), "unconfirmed");
});
