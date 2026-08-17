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
    if (typeof field === "string") {
      parts.push(...framePart(utf8(field)));
    } else if (typeof field === "number") {
      parts.push(...framePart(u32be(field)));
    } else if (field instanceof Uint8Array) {
      parts.push(...framePart(field));
    } else {
      throw new ProtocolError("framed field must be a string, a uint32 or a Uint8Array");
    }
  }
  return concat(...parts);
}

function framePart(bytes: Uint8Array): [Uint8Array, Uint8Array] {
  return [u32be(bytes.length), bytes];
}
