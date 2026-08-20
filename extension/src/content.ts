import { pickPassword, pickUsername, type InputLike } from "./fill.ts";

function visibleInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll("input")].filter((input) => {
    if (input.type === "hidden" || input.disabled) return false;
    const style = getComputedStyle(input);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function describe(input: HTMLInputElement): InputLike {
  return {
    type: input.type,
    name: input.name,
    id: input.id,
    autocomplete: input.getAttribute("autocomplete") ?? "",
  };
}

function setValue(input: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(input) as { value?: PropertyDescriptor };
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(input, value);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillForm(username: string, password: string): boolean {
  const inputs = visibleInputs();
  const likes = inputs.map(describe);
  const userLike = pickUsername(likes);
  const passLike = pickPassword(likes);
  const user = userLike ? inputs[likes.indexOf(userLike)] : null;
  const pass = passLike ? inputs[likes.indexOf(passLike)] : null;
  if (user && username) setValue(user, username);
  if (pass && password) setValue(pass, password);
  return Boolean(user || pass);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "fill-form") return;
  const ok = fillForm(String(message.username ?? ""), String(message.password ?? ""));
  sendResponse({ ok });
});
