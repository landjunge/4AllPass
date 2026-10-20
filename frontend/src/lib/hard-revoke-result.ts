import type { UnlockedVault } from "./vault-session.ts";

/** Local receipt after verified snapshot CAS and pin adoption, before metadata I/O. */
export interface CommittedHardRevoke {
  vault: UnlockedVault;
  targetDeviceId: string;
  selfRevoked: boolean;
}
