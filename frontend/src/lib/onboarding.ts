const PREFIX = "4allpass.onboarding.v1.";

export function onboardingStorageKey(vaultId: string): string {
  return `${PREFIX}${vaultId}`;
}

export function isOnboardingDone(vaultId: string): boolean {
  try {
    return localStorage.getItem(onboardingStorageKey(vaultId)) === "done";
  } catch {
    return false;
  }
}

export function markOnboardingDone(vaultId: string): void {
  try {
    localStorage.setItem(onboardingStorageKey(vaultId), "done");
  } catch {
    // Private mode — wizard may reappear; that is acceptable.
  }
}
