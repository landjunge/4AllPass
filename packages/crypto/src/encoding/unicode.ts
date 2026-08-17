import { utf8 } from "./bytes.ts";

/** Unicode NFC, then UTF-8. Required for master-password derivation. */
export function utf8Nfc(value: string): Uint8Array {
  return utf8(value.normalize("NFC"));
}
