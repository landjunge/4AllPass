import { deriveDeviceWrappingKey, unwrapDeviceKey, wrapDeviceKey } from "./device.ts";
import { zeroize } from "./memory.ts";
import { ProtocolError } from "./errors.ts";
import type { DeviceKeyEnvelope, DeviceUnlockMechanism } from "./types.ts";

export const DEVICE_UNLOCK_MECHANISMS = ["prf", "large_blob", "uv_gated_local"] as const;

const UNLOCK_RANK: Record<DeviceUnlockMechanism, number> = {
  prf: 1,
  large_blob: 2,
  uv_gated_local: 3,
};

/**
 * Choose the strongest available device-unlock mechanism.
 * Master-password unlock is not ranked here and must remain possible on every device.
 */
export function selectDeviceUnlock(
  available: readonly DeviceUnlockMechanism[],
): DeviceUnlockMechanism | undefined {
  let best: DeviceUnlockMechanism | undefined;
  for (const mechanism of available) {
    if (!UNLOCK_RANK[mechanism]) {
      throw new ProtocolError(`unknown device unlock mechanism: ${mechanism}`);
    }
    if (!best || UNLOCK_RANK[mechanism] < UNLOCK_RANK[best]) best = mechanism;
  }
  return best;
}

export interface DeviceKeyFromPrfOptions {
  prfOutput: Uint8Array;
  rpId: string;
  vaultId: string;
  deviceId: string;
  credentialId: Uint8Array;
  cryptoVersion?: number;
}

/**
 * Derive DWK, wrap DK, then zeroize PRF output and DWK.
 * Callers must not reuse `prfOutput` afterwards.
 */
export function wrapDeviceKeyFromPrf(
  opts: DeviceKeyFromPrfOptions & { deviceKey: Uint8Array },
): DeviceKeyEnvelope {
  const dwk = deriveDeviceWrappingKey(opts);
  try {
    return wrapDeviceKey({
      deviceKey: opts.deviceKey,
      deviceWrappingKey: dwk,
      vaultId: opts.vaultId,
      deviceId: opts.deviceId,
      credentialId: opts.credentialId,
      cryptoVersion: opts.cryptoVersion,
    });
  } finally {
    zeroize(opts.prfOutput, dwk);
  }
}

/**
 * Derive DWK, unwrap DK, then zeroize PRF output and DWK.
 * The returned Device Key is the caller's responsibility.
 */
export function unwrapDeviceKeyFromPrf(
  opts: DeviceKeyFromPrfOptions & { envelope: DeviceKeyEnvelope },
): Uint8Array {
  const dwk = deriveDeviceWrappingKey(opts);
  try {
    return unwrapDeviceKey(opts.envelope, dwk);
  } finally {
    zeroize(opts.prfOutput, dwk);
  }
}
