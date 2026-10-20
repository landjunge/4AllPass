import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountCommands } from "../index.ts";
import { describeError } from "../../feedback/index.ts";

function account() {
  const requests: Array<{ kind: string; password: string }> = [];
  const commands = createAccountCommands({
    gateway: {
      async register(_email, password) {
        requests.push({ kind: "register", password });
        return { email: "synthetic@example.test" };
      },
      async login(_email, password) {
        requests.push({ kind: "login", password });
        return { email: "synthetic@example.test" };
      },
      async localSession() { return { email: "local@127.0.0.1" }; },
      async logout() {},
    },
    async runWithStatus(action) { return action(); },
    setEmail() {}, rememberPassword() {}, afterSignUp() {},
    async afterSignIn() {}, beforeSignOut() {}, afterSignOut() {},
  });
  return { commands, requests };
}

test("registration counts Unicode code points and preserves the entire allowed value", async () => {
  for (const password of ["x".repeat(15), "😀".repeat(15), "😀".repeat(256)]) {
    const { commands, requests } = account();
    await commands.signUp("synthetic@example.test", password);
    assert.deepEqual(requests, [{ kind: "register", password }]);
  }
});

test("short and oversized registration values fail before a network request", async () => {
  for (const [password, code] of [
    ["x".repeat(14), "account_password_too_short"],
    ["😀".repeat(7), "account_password_too_short"],
    ["😀".repeat(14), "account_password_too_short"],
    ["😀".repeat(257), "account_password_too_long"],
  ]) {
    const { commands, requests } = account();
    await assert.rejects(commands.signUp("synthetic@example.test", password), (error) => {
      assert.equal(describeError(error).code, code);
      return true;
    });
    assert.deepEqual(requests, []);
  }
});

test("existing short and now-listed account passwords still reach login unchanged", async () => {
  for (const password of ["x".repeat(12), "x".repeat(14), "passwordpassword"]) {
    const { commands, requests } = account();
    await commands.signIn("synthetic@example.test", password);
    assert.deepEqual(requests, [{ kind: "login", password }]);
  }
});
