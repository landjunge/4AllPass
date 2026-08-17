import { ProtocolError } from "../errors.ts";
import { concat, u32be, utf8 } from "./bytes.ts";

export type FramedField = string | Uint8Array | number;

/**
 * uint32be-length-prefixed framing for *digest preimages*.
 *
 * Deliberately separate from the AAD encoder in `aad.ts`:
 * AAD fields are uint16be-prefixed (65 535 byte ceiling), which is fine for ids
 * and versions but not for entry ciphertexts. A digest preimage must be able to
 * cover an arbitrarily long ciphertext without silently changing framing.
 *
 * `number` fields are encoded as uint32be (4 bytes) before framing.
 */
export function frame(fields: readonly FramedField[]): Uint8Array {
  if (fields.length === 0) {
    throw new ProtocolError("framed preimage must contain at least one field");
  }
  const parts: Uint8Array[] = [];
  for (const field of fields) {
    const bytes =
      typeof field === "string" ? utf8(field) : typeof field === "number" ? u32be(field) : field;
    parts.push(u32be(bytes.length), bytes);
  }
  return concat(...parts);
}
