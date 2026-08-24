/** Opaque vault pointer. No unlock, no envelopes, no HTTP. */
export interface VaultRef {
  id: string;
  revision: number;
  vaultKeyVersion: number;
}
