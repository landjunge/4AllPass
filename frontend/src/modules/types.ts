export const MODULE_NAMES = [
  "app-shell", "startup", "account", "vault-lifecycle", "recovery",
  "entries", "import", "autofill", "browser-profiles", "devices",
  "sharing", "settings", "agent-access", "desktop-adapter", "feedback",
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];
