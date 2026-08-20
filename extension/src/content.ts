function visibleInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll("input")].filter((input) => {
    if (input.type === "hidden" || input.disabled) return false;
    const style = getComputedStyle(input);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function pickUsername(inputs: HTMLInputElement[]): HTMLInputElement | null {
  const scored = inputs.filter((input) => input.type !== "password");
  const named = scored.find((input) =>
    /user|email|login|id/i.test(`${input.name} ${input.id} ${input.autocomplete}`),
  );
  return named ?? scored[0] ?? null;
}

function pickPassword(inputs: HTMLInputElement[]): HTMLInputElement | null {
  return inputs.find((input) => input.type === "password") ?? null;
}

function setValue(input: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(input) as { value?: PropertyDescriptor };
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(input, value);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "fill-form") return;
  const inputs = visibleInputs();
  const user = pickUsername(inputs);
  const pass = pickPassword(inputs);
  if (user && typeof message.username === "string") setValue(user, message.username);
  if (pass && typeof message.password === "string") setValue(pass, message.password);
  sendResponse({ ok: Boolean(user || pass) });
  return true;
});
