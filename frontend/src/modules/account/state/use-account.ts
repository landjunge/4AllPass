import { useCallback, useMemo, useRef, useState } from "react";

import { passwordsAreSame } from "../../../lib/password-separation.ts";
import {
  createAccountCommands,
  type AccountCommands,
  type AccountGateway,
  type RunWithStatus,
} from "../service/account-commands.ts";

export interface UseAccountOptions {
  gateway: AccountGateway;
  runWithStatus: RunWithStatus;
  afterSignIn(): Promise<unknown>;
  afterSignUp(): void;
  beforeSignOut(): void;
  afterSignOut(): void;
}

export interface AccountState extends AccountCommands {
  email: string | null;
  restoreSession(email: string | null): void;
  passwordsCollide(vaultPassword: string): boolean;
}

export function useAccount(options: UseAccountOptions): AccountState {
  const {
    gateway,
    runWithStatus,
    afterSignIn,
    afterSignUp,
    beforeSignOut,
    afterSignOut,
  } = options;
  const [email, setEmail] = useState<string | null>(null);
  const accountPasswordRef = useRef<string | null>(null);

  const rememberPassword = useCallback((password: string | null) => {
    accountPasswordRef.current = password;
  }, []);

  const restoreSession = useCallback((sessionEmail: string | null) => {
    accountPasswordRef.current = null;
    setEmail(sessionEmail);
  }, []);

  const passwordsCollide = useCallback((vaultPassword: string) => {
    return passwordsAreSame(accountPasswordRef.current ?? "", vaultPassword);
  }, []);

  const commands = useMemo(
    () =>
      createAccountCommands({
        gateway,
        runWithStatus,
        setEmail,
        rememberPassword,
        afterSignIn,
        afterSignUp,
        beforeSignOut,
        afterSignOut,
      }),
    [afterSignIn, afterSignOut, afterSignUp, beforeSignOut, gateway, rememberPassword, runWithStatus],
  );

  return useMemo(
    () => ({ email, restoreSession, passwordsCollide, ...commands }),
    [commands, email, passwordsCollide, restoreSession],
  );
}
