/**
 * A lock wins over work that was already in flight.
 *
 * Any mutation that awaits while the vault is open must not commit or adopt
 * new state after `lock()` has zeroized the Vault Key. The lifecycle that owns
 * `lock()` owns a monotonic epoch; a captured liveness check binds the exact
 * vault object and that epoch, so neither a lock nor a vault switch can be
 * mistaken for the original context.
 */
export class VaultLockedError extends Error {
  constructor(message = "the vault was locked while the operation was in flight") {
    super(message);
    this.name = "VaultLockedError";
  }
}

export interface VaultLiveness {
  /** Lock epoch captured when the mutation started. */
  readonly epoch: number;
  /** True only while this vault is still current and no lock has happened. */
  isLive(): boolean;
  /** Throws `VaultLockedError` when the captured context is gone. */
  assertLive(): void;
}

export function captureVaultLiveness<T>(
  vault: T,
  currentEpoch: () => number,
  currentVault: () => T | null,
): VaultLiveness {
  const epoch = currentEpoch();
  const isLive = () => currentVault() === vault && currentEpoch() === epoch;
  return {
    epoch,
    isLive,
    assertLive() {
      if (!isLive()) throw new VaultLockedError();
    },
  };
}
