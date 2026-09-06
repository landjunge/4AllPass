import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccountCommands, type AccountGateway } from "../index.ts";

test("registration, logout, and login run in the order a new user experiences them", async () => {
  const events: string[] = [];
  let email: string | null = null;
  let rememberedPassword: string | null = null;
  const gateway: AccountGateway = {
    async register(nextEmail) {
      events.push("register");
      return { email: nextEmail };
    },
    async logout() {
      events.push("logout");
    },
    async login(nextEmail) {
      events.push("login");
      return { email: nextEmail };
    },
    async localSession() {
      throw new Error("not used");
    },
  };
  const commands = createAccountCommands({
    gateway,
    async runWithStatus(action) {
      events.push("status:start");
      await action();
    },
    setEmail(nextEmail) {
      email = nextEmail;
      events.push(`email:${nextEmail ?? "none"}`);
    },
    rememberPassword(password) {
      rememberedPassword = password;
      events.push(`password:${password === null ? "cleared" : "remembered"}`);
    },
    async afterSignIn() {
      events.push("vaults:load");
    },
    afterSignUp() {
      events.push("vaults:empty");
    },
    beforeSignOut() {
      events.push("vault:lock");
    },
    afterSignOut() {
      events.push("vaults:clear");
    },
  });

  await commands.signUp("new@example.test", "account-one");
  assert.equal(email, "new@example.test");
  assert.equal(rememberedPassword, "account-one");

  await commands.signOut();
  assert.equal(email, null);
  assert.equal(rememberedPassword, null);

  await commands.signIn("new@example.test", "account-two");
  assert.equal(email, "new@example.test");
  assert.equal(rememberedPassword, "account-two");
  assert.deepEqual(events, [
    "status:start",
    "register",
    "password:remembered",
    "email:new@example.test",
    "vaults:empty",
    "vault:lock",
    "password:cleared",
    "logout",
    "email:none",
    "vaults:clear",
    "status:start",
    "login",
    "password:remembered",
    "email:new@example.test",
    "vaults:load",
  ]);
});

test("registration conflicts remain visible to the sign-up screen", async () => {
  const conflict = Object.assign(new Error("already registered"), {
    name: "ApiError",
    status: 409,
  });
  const commands = createAccountCommands({
    gateway: {
      async register() {
        throw conflict;
      },
      async login() {
        throw new Error("not used");
      },
      async localSession() {
        throw new Error("not used");
      },
      async logout() {},
    },
    async runWithStatus(action) {
      return action();
    },
    setEmail() {},
    rememberPassword() {},
    async afterSignIn() {},
    afterSignUp() {},
    beforeSignOut() {},
    afterSignOut() {},
  });

  await assert.rejects(commands.signUp("known@example.test", "password"), (error) => {
    return error === conflict && (error as { status: number }).status === 409;
  });
});

test("local sessions clear any remembered account password", async () => {
  const passwords: Array<string | null> = ["old-account-password"];
  const commands = createAccountCommands({
    gateway: {
      async localSession() {
        return { email: "local@4allpass.local" };
      },
      async login() {
        throw new Error("not used");
      },
      async register() {
        throw new Error("not used");
      },
      async logout() {},
    },
    async runWithStatus(action) {
      return action();
    },
    setEmail() {},
    rememberPassword(password) {
      passwords.push(password);
    },
    async afterSignIn() {},
    afterSignUp() {},
    beforeSignOut() {},
    afterSignOut() {},
  });

  await commands.openThisMac();
  assert.deepEqual(passwords, ["old-account-password", null]);
});
