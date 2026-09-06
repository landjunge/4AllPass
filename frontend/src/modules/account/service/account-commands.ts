export interface AccountSession {
  email: string;
}

export interface AccountGateway {
  login(email: string, password: string): Promise<AccountSession>;
  register(email: string, password: string): Promise<AccountSession>;
  localSession(): Promise<AccountSession>;
  logout(): Promise<void>;
}

export type RunWithStatus = <T>(action: () => Promise<T>) => Promise<T>;

interface AccountCommandEffects {
  gateway: AccountGateway;
  runWithStatus: RunWithStatus;
  setEmail(email: string | null): void;
  rememberPassword(password: string | null): void;
  afterSignIn(): Promise<unknown>;
  afterSignUp(): void;
  beforeSignOut(): void;
  afterSignOut(): void;
}

export interface AccountCommands {
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  openThisMac(): Promise<void>;
  signOut(): Promise<void>;
}

/**
 * Coordinates account sessions only. Vault loading and locking stay behind
 * callbacks, so this module never receives vault plaintext or cryptographic keys.
 */
export function createAccountCommands(effects: AccountCommandEffects): AccountCommands {
  return {
    async signIn(email, password) {
      await effects.runWithStatus(async () => {
        const session = await effects.gateway.login(email, password);
        effects.rememberPassword(password);
        effects.setEmail(session.email);
        await effects.afterSignIn();
      });
    },

    async signUp(email, password) {
      await effects.runWithStatus(async () => {
        const session = await effects.gateway.register(email, password);
        effects.rememberPassword(password);
        effects.setEmail(session.email);
        effects.afterSignUp();
      });
    },

    async openThisMac() {
      await effects.runWithStatus(async () => {
        const session = await effects.gateway.localSession();
        effects.rememberPassword(null);
        effects.setEmail(session.email);
        await effects.afterSignIn();
      });
    },

    async signOut() {
      effects.beforeSignOut();
      effects.rememberPassword(null);
      await effects.gateway.logout();
      effects.setEmail(null);
      effects.afterSignOut();
    },
  };
}
