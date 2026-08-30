import { ext } from "./browser.ts";
import {
  FILL_CONFIDENCE_THRESHOLD,
  buildLoginModel,
  isSignupPath,
  leftoverAssistFields,
  modelHints,
  shouldOfferAssist,
  type FillMode,
  type FillResult,
  type InputLike,
  probeFromModel,
} from "./fill.ts";

function isFillableInput(input: HTMLInputElement): boolean {
  if (input.hidden || input.type === "hidden" || input.disabled || input.readOnly) return false;
  if (input.getAttribute("aria-hidden") === "true") return false;
  if (input.closest("[inert]")) return false;
  const dialog = input.closest("dialog");
  if (dialog instanceof HTMLDialogElement && !dialog.open) return false;
  const style = getComputedStyle(input);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (Number.parseFloat(style.opacity) < 0.05) return false;
  if (style.pointerEvents === "none") return false;
  const box = input.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return false;
  return true;
}

function visibleInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll("input")].filter(isFillableInput);
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
  if (isSignupPath(location.pathname)) {
    return {
      ok: false,
      fields: [],
      filled: [],
      mode: "skipped",
      reason: "signup",
      pageOrigin: location.origin,
    };
  }
  const likes = visibleInputs().map(describe);
  return {
    ...probeFromModel(likes, buildLoginModel(likes)),
    pageOrigin: location.origin,
    fieldNames: likes.map((like) => like.name || like.id).filter(Boolean),
    fieldLabels: likes
      .map((like) => like.labelText || like.ariaLabel || like.placeholder || "")
      .filter(Boolean),
  };
}

function findNamedInput(field: string): HTMLInputElement | undefined {
  const needle = field.trim().toLowerCase();
  if (!needle) return undefined;
  const inputs = visibleInputs();
  const likes = inputs.map(describe);
  const index = likes.findIndex((like) =>
    [like.name, like.id, like.labelText, like.ariaLabel, like.placeholder].some(
      (value) => value && value.toLowerCase() === needle,
    ),
  );
  return index >= 0 ? inputs[index] : undefined;
}

function fillNamedField(field: string, value: string): FillResult {
  const likes = visibleInputs().map(describe);
  const target = findNamedInput(field);
  if (!target || !value) {
    return {
      ...probeFromModel(likes, buildLoginModel(likes)),
      ok: false,
      pageOrigin: location.origin,
      filled: [],
      mode: "skipped",
      reason: "no-fields",
    };
  }
  const mode = safeFill(target, value);
  const ok = mode !== "failed" && target.value === value;
  return {
    ok,
    pageOrigin: location.origin,
    fields: ["password"],
    filled: ok ? ["password"] : [],
    mode,
    reason: ok ? undefined : "verify-mismatch",
    fieldNames: [field],
  };
}

function fillForm(username: string, password: string, otp = "", assist = false): FillResult {
  if (isSignupPath(location.pathname)) {
    return {
      ok: false,
      fields: [],
      filled: [],
      mode: "skipped",
      reason: "signup",
      pageOrigin: location.origin,
    };
  }
  const inputs = visibleInputs();
  const likes = inputs.map(describe);
  const model = buildLoginModel(likes, assist ? 0 : FILL_CONFIDENCE_THRESHOLD);

  if (!model.eligible) {
    return probeFromModel(likes, model);
  }

  const userEl = model.username ? inputs[likes.indexOf(model.username.input)] : undefined;
  const passEl = model.password ? inputs[likes.indexOf(model.password.input)] : undefined;
  const otpEl = model.otp ? inputs[likes.indexOf(model.otp.input)] : undefined;

  const fields: Array<"username" | "password" | "otp"> = [];
  const modes: FillMode[] = [];

  if (userEl && username) {
    modes.push(safeFill(userEl, username));
    fields.push("username");
  }
  if (passEl && password) {
    modes.push(safeFill(passEl, password));
    fields.push("password");
  }
  if (otpEl && otp) {
    modes.push(safeFill(otpEl, otp));
    fields.push("otp");
  }

  if (fields.length === 0) {
    return {
      ok: false,
      fields,
      filled: [],
      mode: "skipped",
      reason: "no-fields",
      confidence: model.confidence,
    };
  }

  const filled: Array<"username" | "password" | "otp"> = [];
  if (fields.includes("username") && userEl && userEl.value === username) filled.push("username");
  if (fields.includes("password") && passEl && passEl.value === password) filled.push("password");
  if (fields.includes("otp") && otpEl && otpEl.value === otp) filled.push("otp");

  const mode = mergeMode(modes);
  const weak = buildLoginModel(likes, 0);
  const assistFields = !assist && shouldOfferAssist(likes) ? leftoverAssistFields(model, weak) : [];
  const hints = modelHints(assist ? weak : model);
  if (mode === "failed" || filled.length !== fields.length) {
    return {
      ok: false,
      fields,
      filled,
      assistFields,
      hints,
      mode: mode === "failed" ? "failed" : mode,
      reason: "verify-mismatch",
      confidence: model.confidence,
    };
  }

  return { ok: true, fields, filled, assistFields, hints, mode, confidence: model.confidence };
}

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "probe-form") {
    sendResponse(probeForm());
    return;
  }
  const expectedOrigin = typeof message.expectedOrigin === "string" ? message.expectedOrigin : "";
  if (message?.type === "fill-named-field") {
    if (!expectedOrigin || expectedOrigin !== location.origin) {
      sendResponse({
        ok: false,
        fields: [],
        filled: [],
        mode: "skipped",
        reason: "origin-mismatch",
        pageOrigin: location.origin,
      } satisfies FillResult);
      return;
    }
    sendResponse(fillNamedField(String(message.field ?? ""), String(message.value ?? "")));
    return;
  }
  if (message?.type !== "fill-form") return;
  if (!expectedOrigin || expectedOrigin !== location.origin) {
    sendResponse({
      ok: false,
      fields: [],
      filled: [],
      mode: "skipped",
      reason: "origin-mismatch",
      pageOrigin: location.origin,
    } satisfies FillResult);
    return;
  }
  sendResponse(
    fillForm(
      String(message.username ?? ""),
      String(message.password ?? ""),
      String(message.otp ?? ""),
      message.assist === true,
    ),
  );
});
