// Injected only by the separate debug probe. DOM/IDB actions only; no API or
// state mocks. The real throwaway backend supplies the account/vault/snapshot.
(() => {
  const kind = window.__NATIVE_SCENARIO_KIND__;
  const result = window.__NATIVE_MIGRATION__ = {
    done: false, passed: false, stage: "boot", phase: "", ack: "", checks: [],
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const byId = id => document.querySelector(`[data-testid="${id}"]`);
  const text = id => (byId(id)?.textContent || "");
  const wait = async (stage, predicate, tries = 600) => {
    result.stage = stage;
    for (let i = 0; i < tries; i++) {
      if (predicate()) return;
      await sleep(100);
    }
    throw new Error(`stage-timeout:${stage}`);
  };
  const check = name => result.checks.push(name);
  const fillField = (field, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const fill = (id, value) => fillField(byId(id), value);
  const click = async id => {
    const el = byId(id);
    if (!el || el.disabled) throw new Error(`unavailable-action:${id}`);
    el.click();
    await sleep(150);
  };
  const unlocked = () => byId("lock-state")?.textContent === "UNLOCKED";
  const fixture = window.__NATIVE_FIXTURE__ || {};
  const accountEmail = fixture.email;
  const accountPassword = fixture.password;
  const vaultPassword = fixture.vaultPassword;
  if (!accountEmail || !accountPassword || !vaultPassword) {
    result.error = "native-fixture-contract-missing";
    result.done = true;
    result.passed = false;
    return;
  }

  const openDb = (name, version, store) => new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  const idbGet = async (name, store, key) => {
    const db = await openDb(name, 1, store);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => { resolve(req.result ?? null); db.close(); };
      req.onerror = () => reject(req.error);
    });
  };
  const idbPut = async (name, store, key, value) => {
    const db = await openDb(name, 1, store);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const req = tx.objectStore(store).put(value, key);
      req.onsuccess = () => { resolve(); db.close(); };
      req.onerror = () => reject(req.error);
    });
  };
  const headCacheKey = () => localStorage.getItem("4allpass.active-vault");
  const readHead = async () => idbGet("4allpass-snapshot-cache", "wire", headCacheKey());
  const writeHead = async value => idbPut("4allpass-snapshot-cache", "wire", headCacheKey(), value);
  const readReservation = async () =>
    idbGet("4allpass-legacy-migration", "attempts", headCacheKey());
  const readBackup = async () =>
    idbGet("4allpass-snapshot-cache", "wire", `legacy:${headCacheKey()}`);

  const ipcTransportProbe = async () => {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== "function") {
      return { ok: false, error: "tauri-internals-unavailable" };
    }
    try {
      // The raw Tauri IPC call used by @tauri-apps/api/core; no module import
      // (eval-injected drivers cannot resolve bare package specifiers).
      await internals.invoke("sidecar_http", {
        method: "GET",
        path: "/api/v1/health",
        headers: {},
        body: null,
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        typeof: typeof error,
        constructor: error && error.constructor ? error.constructor.name : null,
        isTypeError: error instanceof TypeError,
        message: String(error && error.message ? error.message : error).slice(0, 240),
      };
    }
  };

  const tryUnlockSameContext = async () => {
    if (unlocked()) return { ok: true };
    await wait("offline-unlock-screen", () => byId("master-password"));
    fill("master-password", vaultPassword);
    await sleep(100);
    await click("unlock-submit");
    for (let i = 0; i < 250; i++) {
      if (unlocked()) return { ok: true };
      const error = (byId("error-banner")?.textContent || "").trim();
      if (error) return { ok: false, error };
      await sleep(100);
    }
    return { ok: false, error: "unlock-timeout" };
  };

  const skipOnboarding = async () => {
    for (let i = 0; i < 40; i++) {
      if (byId("onboarding-skip") && !byId("onboarding-skip").disabled) {
        byId("onboarding-skip").click();
        check("onboarding-skip");
        return;
      }
      if (byId("onboarding-done") && !byId("onboarding-done").disabled) {
        byId("onboarding-done").click();
        check("onboarding-done");
        return;
      }
      await sleep(100);
    }
  };

  const authMode = () => {
    const submit = byId("auth-submit");
    const submitLabel = (submit?.textContent || "").trim();
    if (/^(Anmelden|Sign in)$/i.test(submitLabel)) return "sign-in";
    if (/^(Konto anlegen|Create account)$/i.test(submitLabel)) return "sign-up";
    const heading = (document.querySelector("form.auth h2")?.textContent || "").trim();
    if (/^(Anmelden|Sign in)$/i.test(heading)) return "sign-in";
    if (/^(Konto anlegen|Create account)$/i.test(heading)) return "sign-up";
    return "unknown";
  };

  const signIn = async () => {
    if (byId("auth-submit")) {
      // The app defaults to sign-up on a fresh store and sign-in when it
      // remembered the e-mail. Only switch when the current mode is sign-up.
      let mode = authMode();
      if (mode === "sign-up") {
        if (!byId("auth-switch")) throw new Error("auth-mode-switch-missing");
        byId("auth-switch").click();
        await sleep(250);
        mode = authMode();
      }
      if (mode !== "sign-in") throw new Error(`auth-mode-unexpected:${mode}`);
      fillField(document.querySelector('input[type="email"]'), accountEmail);
      fillField(document.querySelector('input[type="password"]'), accountPassword);
      await sleep(100);
      await click("auth-submit");
      await sleep(500);
      const error = byId("error-banner");
      if (error && (error.textContent || "").trim()) {
        throw new Error("account-login-failed:" + (error.textContent || "").trim());
      }
      check("account-login");
    }
    // Account UI may show the vault create/unlock screen next; the seeded vault
    // already exists, so unlock is the expected branch.
    await wait("after-account-login", () => byId("master-password") || byId("lock-state") || byId("vault-password"));
    if (byId("vault-password") && !byId("master-password")) {
      throw new Error("unexpected-create-screen: seeded vault missing");
    }
  };

  const unlock = async () => {
    if (unlocked()) return;
    await wait("unlock-screen", () => byId("master-password"));
    fill("master-password", vaultPassword);
    await sleep(100);
    await click("unlock-submit");
    await wait("unlocked", unlocked);
    check("master-unlock");
  };

  (async () => {
    try {
      const phaseAfterReload = sessionStorage.getItem("__nativeMigrationPhase") || "";
      await wait("startup", () => byId("auth-submit") || byId("master-password") || byId("lock-state") || byId("vault-password"));
      if (!phaseAfterReload) {
        await signIn();
        await skipOnboarding();
        await unlock();
        await wait("legacy-banner", () => byId("legacy-migration-banner") && byId("legacy-migration-now"));
        check("legacy-banner");
        await sleep(1200);
        if (!byId("legacy-migration-banner")) throw new Error("banner-vanished-without-action");
        check("no-automatic-banner-dismiss");
        const wire = await readHead();
        if (!wire) throw new Error("head-cache-missing");
        result.wireRevision = wire.revision;
        result.wireHasManifest = Boolean(wire.sealedManifest);
        check("head-cache-read");

        if (kind === "unknown-fields") {
          const decorated = structuredClone(wire);
          decorated.futureTop = { note: "offline keep" };
          decorated.entries[0].futureEntry = "keep-entry";
          decorated.envelopes[0].futureEnvelope = { nested: [4, 5, 6] };
          await writeHead(decorated);
          check("unknown-fields-headcache-written");
          // Keep the initialized account/vault context; only lock the vault.
          // This isolates snapshot unreachability from a full offline bootstrap.
          await click("lock");
          await wait("locked-before-offline", () => !unlocked() && byId("master-password"));
          check("locked-before-offline");
          result.phase = "before-offline";
          await wait("wait-own-sidecar-stop", () => result.ack !== "", 300);
          if (result.ack !== "sidecar-stopped") throw new Error(`own-sidecar-stop-failed:${result.ack}`);
          check("own-sidecar-stopped");
          result.transportError = await ipcTransportProbe();
          const offline = await tryUnlockSameContext();
          if (!offline.ok) {
            result.offlineBoundary = "initialized-context-cache-fallback-unavailable";
            result.error = `offline-unlock-failed:${offline.error}`;
            result.done = true;
            result.passed = false;
            return;
          }
          check("offline-headcache-unlock");
          await wait("offline-banner", () => byId("legacy-migration-banner") && byId("legacy-migration-now"));
          await click("legacy-migration-now");
          await wait("unsupported-message", () =>
            text("legacy-migration-banner").includes("nicht verlustfrei") ||
            text("legacy-migration-banner").includes("losslessly"));
          check("unsupported-before-post");
          const receipt = await readReservation();
          if (!receipt || receipt.state !== "rejected") throw new Error("receipt-not-rejected");
          result.receiptState = receipt.state;
          const backup = await readBackup();
          if (!backup) throw new Error("unknown-field-backup-missing");
          if (backup.futureTop?.note !== "offline keep") throw new Error("unknown-top-not-preserved");
          if (backup.entries?.[0]?.futureEntry !== "keep-entry") throw new Error("unknown-entry-not-preserved");
          if (backup.envelopes?.[0]?.futureEnvelope?.nested?.[0] !== 4) throw new Error("unknown-envelope-not-preserved");
          result.backupUnknownFields = true;
          check("unknown-fields-backup-equal");
          await click("lock");
          await wait("locked", () => !unlocked() && !byId("legacy-migration-banner"));
          check("lock-hides-banner");
          result.passed = true;
          result.done = true;
          return;
        }

        result.phase = "before-post";
        await wait("wait-own-sidecar-stop", () => result.ack !== "", 300);
        if (result.ack !== "sidecar-stopped") throw new Error(`own-sidecar-stop-failed:${result.ack}`);
        check("own-sidecar-stopped");
        await click("legacy-migration-now");
        await wait("unknown-message", () =>
          text("legacy-migration-banner").includes("Ausgang ist unklar") ||
          text("legacy-migration-banner").includes("outcome is unknown"));
        check("unknown-outcome");
        const receipt = await readReservation();
        if (!receipt || receipt.state !== "unknown") throw new Error("receipt-not-unknown");
        result.receiptState = receipt.state;
        result.receiptBaseRevision = receipt.baseRevision;
        result.receiptDigest = typeof receipt.preparedManifestDigest === "string";
        check("reservation-unknown");
        result.phase = "restart-sidecar";
        await wait("wait-own-sidecar-restart", () => result.ack === "sidecar-restarted", 300);
        if (result.ack !== "sidecar-restarted") throw new Error("own-sidecar-restart-failed");
        check("own-sidecar-restarted");
        sessionStorage.setItem("__nativeMigrationPhase", "after-unknown");
        location.reload();
        return;
      }

      await wait("startup-reload", () => byId("auth-submit") || byId("master-password") || byId("lock-state") || byId("vault-password"));
      if (phaseAfterReload === "after-unknown") {
        await signIn();
        await unlock();
        await wait("blocked-banner", () =>
          text("legacy-migration-banner").includes("letzte Versuch ist unklar") ||
          text("legacy-migration-banner").includes("last attempt is unknown"));
        if (byId("legacy-migration-now") && !byId("legacy-migration-now").disabled) {
          throw new Error("blocked-button-enabled");
        }
        check("blocked-no-second-post");
        const receipt = await readReservation();
        if (!receipt || receipt.state !== "unknown") throw new Error("receipt-not-unknown-after-reload");
        result.receiptStateAfterReload = receipt.state;
        const backup = await readBackup();
        if (!backup || backup.revision !== 1) throw new Error("known-backup-missing");
        result.knownBackupRevision = backup.revision;
        check("known-backup-present");
        await click("lock");
        await wait("locked", () => !unlocked() && !byId("legacy-migration-banner"));
        check("lock-hides-banner");
        result.passed = true;
        result.done = true;
        return;
      }

      if (phaseAfterReload === "offline-unknown-fields") {
        // Offline: the own sidecar is stopped. The app must unlock from the
        // exact raw head cache; if the Tauri IPC error is not classified as
        // offline, this stage fails honestly instead of faking the cache path.
        await signIn();
        await unlock();
        await wait("offline-banner", () => byId("legacy-migration-banner") && byId("legacy-migration-now"));
        check("offline-headcache-unlock");
        await click("legacy-migration-now");
        await wait("unsupported-message", () =>
          text("legacy-migration-banner").includes("nicht verlustfrei") ||
          text("legacy-migration-banner").includes("losslessly"));
        check("unsupported-before-post");
        const receipt = await readReservation();
        if (!receipt || receipt.state !== "rejected") throw new Error("receipt-not-rejected");
        result.receiptState = receipt.state;
        const backup = await readBackup();
        if (!backup) throw new Error("unknown-field-backup-missing");
        if (backup.futureTop?.note !== "offline keep") throw new Error("unknown-top-not-preserved");
        if (backup.entries?.[0]?.futureEntry !== "keep-entry") throw new Error("unknown-entry-not-preserved");
        if (backup.envelopes?.[0]?.futureEnvelope?.nested?.[0] !== 4) throw new Error("unknown-envelope-not-preserved");
        result.backupUnknownFields = true;
        check("unknown-fields-backup-equal");
        await click("lock");
        await wait("locked", () => !unlocked() && !byId("legacy-migration-banner"));
        check("lock-hides-banner");
        result.passed = true;
        result.done = true;
        return;
      }

      throw new Error(`unknown-reload-phase:${phaseAfterReload}`);
    } catch (error) {
      result.error = String(error && error.message ? error.message : error);
      result.done = true;
      result.passed = false;
    }
  })();
})();
