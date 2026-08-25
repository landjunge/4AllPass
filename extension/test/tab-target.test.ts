import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isHttpUrl,
  isPrivilegedExtensionSender,
  pageOrigin,
  pickFillTab,
  sameFillOrigin,
} from "../src/tab-target.ts";

test("isHttpUrl accepts only http(s)", () => {
  assert.equal(isHttpUrl("https://github.com/login"), true);
  assert.equal(isHttpUrl("http://127.0.0.1:8794/test-login.html"), true);
  assert.equal(isHttpUrl("chrome-extension://abc/popup.html"), false);
  assert.equal(isHttpUrl("about:blank"), false);
  assert.equal(isHttpUrl(undefined), false);
});

test("pickFillTab prefers the focused website tab", () => {
  const login = { id: 2, url: "https://github.com/login" };
  const popup = { id: 3, url: "chrome-extension://abc/popup.html" };
  assert.equal(pickFillTab(login, undefined), login);
  assert.equal(pickFillTab(login, { id: 1, url: "http://127.0.0.1/" }), login);
  assert.equal(pickFillTab(popup, login), login);
  assert.equal(pickFillTab(popup, undefined), undefined);
  assert.equal(pickFillTab(undefined, login), login);
});

test("sameFillOrigin refuses a navigation between match and fill", () => {
  assert.equal(sameFillOrigin("https://github.com/login", "https://github.com/session"), true);
  assert.equal(sameFillOrigin("https://github.com/login", "https://evil.example/login"), false);
  assert.equal(sameFillOrigin("https://github.com/login", "http://github.com/login"), false);
  assert.equal(pageOrigin("https://github.com/login"), "https://github.com");
});

test("content-script senders are not privileged", () => {
  assert.equal(isPrivilegedExtensionSender({}), true);
  assert.equal(isPrivilegedExtensionSender({ tab: null }), true);
  assert.equal(isPrivilegedExtensionSender({ tab: { id: 12 } }), false);
});
