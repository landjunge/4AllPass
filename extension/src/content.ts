import { ext } from "./browser.ts";
import {
  buildLoginModel,
  type FillMode,
  type FillResult,
  type InputLike,
  probeFromModel,
} from "./fill.ts";

function visibleInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll("input")].filter((input) => {
    if (input.type === "hidden" || input.disabled || input.readOnly) return false;
    const style = getComputedStyle(input);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function describe(input: HTMLInputElement): InputLike {
  const label = input.labels?.[0]?.textContent?.trim() ?? "";
  return {
    type: input.type,
    name: input.name,
    id: input.id,
    autocomplete: input.getAttribute("autocomplete") ?? "",
    placeholder: input.placeholder || undefined,
    ariaLabel: input.getAttribute("aria-label") || undefined,
    labelText: label || undefined,
    readonly: input.readOnly,
    disabled: input.disabled,
  };
}

function tryNative(input: HTMLInputElement, value: string): boolean {
  try {
    input.focus();
    input.select();
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: value,
      }),
    );
    if (input.value === value) return true;
    const inserted = document.execCommand("insertText", false, value);
    return Boolean(inserted) && input.value === value;
  } catch {
    return input.value === value;
  }
}

function setValueControlled(input: HTMLInputElement, value: string): void {
  const proto = HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(input, value);
  if (input.value !== value) input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function safeFill(input: HTMLInputElement, value: string): FillMode {
  if (tryNative(input, value)) return "native";
  setValueControlled(input, value);
  return input.value === value ? "controlled" : "failed";
}

function mergeMode(modes: FillMode[]): FillMode {
  if (modes.length === 0) return "skipped";
  if (modes.includes("failed")) return "failed";
  if (modes.includes("controlled")) return "controlled";
  if (modes.includes("native")) return "native";
  return "skipped";
}

function probeForm(): FillResult {
  const likes = visibleInputs().map(describe);
  return probeFromModel(likes, buildLoginModel(likes));
}

function fillForm(username: string, password: string): FillResult {
  const inputs = visibleInputs();
  const likes = inputs.map(describe);
  const model = buildLoginModel(likes);

  if (!model.eligible) {
    return probeFromModel(likes, model);
  }

  const userEl = model.username ? inputs[likes.indexOf(model.username.input)] : undefined;
  const passEl = model.password ? inputs[likes.indexOf(model.password.input)] : undefined;

  const fields: Array<"username" | "password"> = [];
  const modes: FillMode[] = [];

  if (userEl && username) {
    modes.push(safeFill(userEl, username));
    fields.push("username");
  }
  if (passEl && password) {
    modes.push(safeFill(passEl, password));
    fields.push("password");
  }

  if (fields.length === 0) {
    return { ok: false, fields: [], mode: "skipped", reason: "no-fields", confidence: model.confidence };
  }

  const mode = mergeMode(modes);
  if (mode === "failed") {
    return { ok: false, fields, mode, reason: "verify-mismatch", confidence: model.confidence };
  }

  const userOk = !fields.includes("username") || Boolean(userEl && userEl.value === username);
  const passOk = !fields.includes("password") || Boolean(passEl && passEl.value === password);
  if (!userOk || !passOk) {
    return { ok: false, fields, mode: "failed", reason: "verify-mismatch", confidence: model.confidence };
  }

  return { ok: true, fields, mode, confidence: model.confidence };
}

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "probe-form") {
    sendResponse(probeForm());
    return;
  }
  if (message?.type !== "fill-form") return;
  sendResponse(fillForm(String(message.username ?? ""), String(message.password ?? "")));
});
