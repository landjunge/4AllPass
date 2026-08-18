export type {
  AssertionLike,
  AttestationLike,
  CreateCredentialRequest,
  DeviceUnlockMechanism,
  DeviceUnlockRecord,
  DeviceUnlockStore,
  ExtensionResultsLike,
  GetAssertionRequest,
  LargeBlobExtensionOutput,
  PrfExtensionOutput,
  WebAuthnClient,
} from "./types.ts";
export { MECHANISM_RANK } from "./types.ts";

export {
  DeviceUnlockError,
  DeviceUnlockUnavailableError,
  PrfUnavailableError,
  UserVerificationError,
  WebAuthnUnavailableError,
} from "./errors.ts";

export { assertUserVerified, parseAuthenticatorData } from "./authenticator-data.ts";
export type { AuthenticatorDataFlags, ParsedAuthenticatorData } from "./authenticator-data.ts";

export { browserWebAuthnClient } from "./browser-client.ts";
export { indexedDbDeviceUnlockStore, memoryDeviceUnlockStore } from "./store.ts";

export { assertPrfOutput, newChallenge, readPrfFirst } from "./prf.ts";
export { resolveChallenge } from "./challenge.ts";
export type { CeremonyPurpose, ChallengeProvider } from "./challenge.ts";
export {
  parseDeviceKeyEnvelope,
  readLargeBlob,
  serializeDeviceKeyEnvelope,
  writeLargeBlob,
} from "./large-blob.ts";

export { DEFAULT_MECHANISMS, disableDeviceUnlock, enableDeviceUnlock } from "./enable.ts";
export type { EnableDeviceUnlockOptions, EnableDeviceUnlockResult } from "./enable.ts";

export { unlockWithDevice } from "./unlock.ts";
export type { DeviceUnlockResult, UnlockWithDeviceOptions } from "./unlock.ts";
