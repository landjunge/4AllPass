import assert from "node:assert/strict";
import { test } from "node:test";
import {
  entriesFromBrowserLogins,
  importReviewRows,
  mergeImportedLogins,
  parsePlaintextExport,
  plaintextImportWarning,
} from "./import.ts";

test("warns that the file is plaintext", () => {
  assert.match(plaintextImportWarning(), /plaintext/i);
});

test("refuses a 4AllPass share file on the plaintext path", () => {
  assert.throws(
    () => parsePlaintextExport(JSON.stringify({ kind: "4allpass-share-v1", snapshot: {} })),
    /share file/i,
  );
});

test("parses Bitwarden JSON logins and skips notes", () => {
  const result = parsePlaintextExport(
    JSON.stringify({
      items: [
        {
          type: 1,
          name: "GitHub",
          notes: "2fa",
          login: {
            username: "ada",
            password: "secret",
            uris: [{ uri: "https://github.com" }],
          },
        },
        { type: 2, name: "Just a note", notes: "no login" },
      ],
    }),
  );
  assert.equal(result.format, "bitwarden-json");
  assert.equal(result.skipped, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.title, "GitHub");
  assert.equal(result.entries[0]?.username, "ada");
  assert.equal(result.entries[0]?.password, "secret");
  assert.equal(result.entries[0]?.url, "https://github.com");
  assert.equal(result.entries[0]?.providerId, "github");
  assert.equal(result.entries[0]?.domain, "github.com");
  assert.equal(result.entries[0]?.kind, "web");
});

test("Bitwarden login with a GitHub PAT is an API key", () => {
  const result = parsePlaintextExport(
    JSON.stringify({
      items: [
        {
          type: 1,
          name: "deploy",
          login: {
            username: "ada",
            password: "ghp_demotokenvalue1",
            uris: [{ uri: "https://github.com" }],
          },
        },
      ],
    }),
  );
  assert.equal(result.entries[0]?.kind, "api");
  assert.equal(result.entries[0]?.provider, "GitHub");
  assert.equal(JSON.stringify(importReviewRows(result.entries)).includes("ghp_demotokenvalue1"), false);
});

test("Bitwarden secure note that is a PAT imports as API", () => {
  const result = parsePlaintextExport(
    JSON.stringify({
      items: [{ type: 2, name: "bot", notes: "ghp_demotokenvalue1" }],
    }),
  );
  assert.equal(result.format, "bitwarden-json");
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.kind, "api");
});

test("CSV token column and .env file classify as API", () => {
  const csv = parsePlaintextExport("title,api_key\nopenai,sk-demotokenvalue12ab\n");
  assert.equal(csv.format, "csv");
  assert.equal(csv.entries[0]?.kind, "api");
  assert.equal(csv.entries[0]?.provider, "OpenAI");
  const env = parsePlaintextExport("OPENAI_API_KEY=sk-demotokenvalue12ab\nGITHUB_TOKEN=ghp_demotokenvalue1\n");
  assert.equal(env.format, "env");
  assert.equal(env.entries.length, 2);
  const json = parsePlaintextExport(JSON.stringify({ OPENAI_API_KEY: "sk-demotokenvalue12ab" }));
  assert.equal(json.format, "provider-json");
  assert.equal(json.entries[0]?.kind, "api");
});

test("parses KeePass-style CSV", () => {
  const result = parsePlaintextExport(
    "Account,Login Name,Password,Web Site,Comments\nBank,ada,pw,https://bank.example,note\n",
  );
  assert.equal(result.format, "csv");
  assert.equal(result.entries[0]?.title, "Bank");
  assert.equal(result.entries[0]?.username, "ada");
  assert.equal(result.entries[0]?.password, "pw");
  assert.equal(result.entries[0]?.url, "https://bank.example");
});

test("parses 1Password unencrypted JSON logins", () => {
  const result = parsePlaintextExport(
    JSON.stringify({
      accounts: [
        {
          vaults: [
            {
              items: [
                {
                  categoryUuid: "001",
                  title: "GitHub",
                  overview: { title: "GitHub", url: "https://github.com" },
                  details: {
                    loginFields: [
                      { designation: "username", value: "ada" },
                      { designation: "password", value: "secret" },
                    ],
                    notesPlain: "2fa",
                  },
                },
                { categoryUuid: "002", title: "Card" },
              ],
            },
          ],
        },
      ],
    }),
  );
  assert.equal(result.format, "onepassword-json");
  assert.equal(result.skipped, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.title, "GitHub");
  assert.equal(result.entries[0]?.username, "ada");
  assert.equal(result.entries[0]?.password, "secret");
  assert.equal(result.entries[0]?.url, "https://github.com");
  assert.equal(result.entries[0]?.notes, "2fa");
});

test("parses 1PIF login lines", () => {
  const result = parsePlaintextExport(
    `***111***
{"title":"Mail","typeName":"webforms.WebForm","secureContents":{"username":"ada","password":"pw","URLs":[{"url":"https://mail.example"}],"notesPlain":""}}
***111***
`,
  );
  assert.equal(result.format, "onepassword-1pif");
  assert.equal(result.entries[0]?.title, "Mail");
  assert.equal(result.entries[0]?.username, "ada");
  assert.equal(result.entries[0]?.password, "pw");
  assert.equal(result.entries[0]?.url, "https://mail.example");
});

test("parses KeePass XML logins and ignores history copies", () => {
  const result = parsePlaintextExport(`<?xml version="1.0"?>
<KeePassFile>
  <Root>
    <Group>
      <Entry>
        <String><Key>Title</Key><Value>Bank</Value></String>
        <String><Key>UserName</Key><Value>ada</Value></String>
        <String><Key>Password</Key><Value ProtectInMemory="True">pw</Value></String>
        <String><Key>URL</Key><Value>https://bank.example</Value></String>
        <String><Key>Notes</Key><Value>keep</Value></String>
        <History>
          <Entry>
            <String><Key>Title</Key><Value>Old Bank</Value></String>
            <String><Key>Password</Key><Value>old</Value></String>
          </Entry>
        </History>
      </Entry>
    </Group>
  </Root>
</KeePassFile>`);
  assert.equal(result.format, "keepass-xml");
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.title, "Bank");
  assert.equal(result.entries[0]?.username, "ada");
  assert.equal(result.entries[0]?.password, "pw");
  assert.equal(result.entries[0]?.url, "https://bank.example");
  assert.equal(result.entries[0]?.notes, "keep");
});

test("refuses zipped or binary exports", () => {
  assert.throws(() => parsePlaintextExport("PK\u0003\u0004export"), /zipped|encrypted/i);
});

test("browser logins become vault entries", () => {
  const entries = entriesFromBrowserLogins([
    { url: "https://mail.example/login", username: "ada", password: "pw", title: "mail.example", source: "chrome:Default" },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "web");
  assert.equal(entries[0]?.username, "ada");
  assert.match(entries[0]?.notes ?? "", /chrome:Default/);
});

test("import review never includes the password field", () => {
  const entries = entriesFromBrowserLogins([
    { url: "https://mail.example/", username: "ada", password: "hunter2", title: "mail.example" },
  ]);
  const rows = importReviewRows(entries);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.username, "ada");
  assert.equal(JSON.stringify(rows).includes("hunter2"), false);
  assert.equal("password" in (rows[0] ?? {}), false);
  assert.equal(rows[0]?.kind, "web");
});

test("merge replaces same host and username", () => {
  const first = entriesFromBrowserLogins([
    { url: "https://mail.example/", username: "ada", password: "old", title: "mail.example" },
  ]);
  const second = entriesFromBrowserLogins([
    { url: "https://mail.example/login", username: "ada", password: "new", title: "mail.example" },
  ]);
  const merged = mergeImportedLogins(first, second);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.password, "new");
});
