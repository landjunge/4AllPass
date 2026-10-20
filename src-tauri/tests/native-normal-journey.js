// Injected only by the separate debug probe. DOM actions; no API/IPC/state mocks.
(() => {
  if (window.__NORMAL_JOURNEY__) return;
  const result = window.__NORMAL_JOURNEY__ = {done:false, passed:false, stage:"boot", checks:[]};
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const byId = id => document.querySelector(`[data-testid="${id}"]`);
  const wait = async (stage, predicate) => {
    result.stage = stage;
    for (let i=0;i<600;i++) { if (predicate()) return; await sleep(100); }
    throw new Error("stage-timeout");
  };
  const check = name => result.checks.push(name);
  const fillField = (field, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,value);
    field.dispatchEvent(new Event("input",{bubbles:true}));
    field.dispatchEvent(new Event("change",{bubbles:true}));
  };
  const fill = (id, value) => fillField(byId(id),value);
  const click = async id => { const el=byId(id); if (!el || el.disabled) throw new Error("unavailable-action"); el.click(); await sleep(100); };
  const unlocked = () => byId("lock-state")?.textContent === "UNLOCKED";
  // Synthetic fixture values stay inside this driver, never in receipts/logs.
  const vaultPassword = "Native journey fixture password 2026!";
  const importedPassword = "Synthetic file fixture only 2026!";
  const unlock = async () => {
    await click("lock");
    await wait("locked",()=>byId("master-password") && !unlocked()); check("manual-lock");
    fill("master-password",vaultPassword); await sleep(100); await click("unlock-submit");
    await wait("master-unlock",unlocked); check("master-unlock");
  };
  (async()=>{
    await wait("normal-first-run",()=>byId("vault-password") || byId("auth-submit"));
    if (byId("auth-submit")) {
      // Current desktop startup intentionally requires account authentication.
      // Exercise the existing supported UI; never call register/local directly.
      fillField(document.querySelector('input[type="email"]'),"native-fixture@example.com");
      fillField(document.querySelector('input[type="password"]'),"Separate account fixture password 2026!");
      await sleep(100); await click("auth-submit");
      await wait("account-ui-to-create",()=>byId("vault-password"));
      check("actual-supported-account-registration-ui");
    } else { check("actual-local-bootstrap-create-ui"); }
    fill("vault-password",vaultPassword); fill("vault-password-repeat",vaultPassword);
    await sleep(100); await click("create-vault");
    await wait("recovery-kit",()=>byId("recovery-key")); check("create-and-kit");
    if (!byId("dismiss-kit")?.disabled) throw new Error("kit-not-gated");
    const download = [...document.querySelectorAll('[role="dialog"] button')]
      .find(b=>/^(Herunterladen|Download)$/.test(b.textContent.trim()));
    if (!download) throw new Error("missing-download-action");
    download.click();
    await wait("private-kit-download",()=>window.__NORMAL_KIT_DOWNLOADED__===true);
    check("actual-private-kit-download");
    await click("confirm-kit-stored"); await click("dismiss-kit");
    await wait("onboarding",()=>byId("onboarding-done"));
    await sleep(500); await click("onboarding-done");
    await wait("empty-desk",()=>byId("import-file") && unlocked());
    await unlock();
    const input=byId("import-file"), transfer=new DataTransfer();
    const csv=`name,url,username,password\nNative fixture alpha,https://alpha.example.invalid,synthetic-alpha,${importedPassword}\nNative fixture beta,https://beta.example.invalid,synthetic-beta,${importedPassword}\n`;
    transfer.items.add(new File([csv],"synthetic-native.csv",{type:"text/csv"}));
    input.files=transfer.files; input.dispatchEvent(new Event("change",{bubbles:true}));
    await wait("file-import-review",()=>byId("import-review"));
    if (byId("import-review").textContent.includes(importedPassword)) throw new Error("plaintext-in-review");
    if (byId("import-review").querySelectorAll("li").length!==2) throw new Error("wrong-review-count");
    check("actual-file-parser-review-two-without-passwords");
    await click("confirm-import");
    await wait("import-committed",()=>!byId("import-review") && document.querySelectorAll('[data-testid^="fav-star-"]').length===2);
    await unlock();
    await wait("decrypted-import-after-relock",()=>document.querySelectorAll('[data-testid^="fav-star-"]').length===2);
    // DOM structure is checked below by the actual row text, never by app context.
    const rows=[...document.querySelectorAll(".row")].map(e=>e.textContent);
    if (!rows.some(t=>t.includes("Native fixture alpha")) || !rows.some(t=>t.includes("Native fixture beta"))) throw new Error("missing-imported-titles");
    result.entryCount=2; result.titles=["Native fixture alpha","Native fixture beta"];
    check("decrypted-two-after-second-unlock");
    result.passed=true; result.stage="complete";
  })().catch(()=>{ result.passed=false; }).finally(()=>{ result.done=true; });
})();
