/**
 * Synthetic render check for the migration banner: DE/EN, both choices, the
 * durable-unknown blocked state, and no automatic migration on render.
 * No product data, no browser, no vault.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Line } from "./copy-mode.ts";
import { LegacyMigrationBannerView } from "../components/vault/LegacyMigrationBannerView.ts";

const de = (line: Line) => line.de;
const en = (line: Line) => line.en;

function view({
  legacy = true,
  blocked = false,
  busy = false,
  message = null,
  t = de,
  onMigrate = () => undefined,
}: {
  legacy?: boolean;
  blocked?: boolean;
  busy?: boolean;
  message?: string | null;
  t?: (line: Line) => string;
  onMigrate?: () => void;
} = {}): string {
  return renderToStaticMarkup(
    createElement(LegacyMigrationBannerView, {
      legacy,
      blocked,
      busy,
      message,
      t,
      onMigrate,
      onLater: () => undefined,
    }),
  );
}

test("DE confirm shows the honest migration warning and both choices", () => {
  const html = view();
  assert.match(html, /noch nicht als Ganzes versiegelt/);
  assert.match(html, /nicht nachträglich beweisen/);
  assert.match(html, /Jetzt aktualisieren/);
  assert.match(html, /Später/);
  assert.match(html, /data-testid="legacy-migration-now"/);
  assert.match(html, /data-testid="legacy-migration-later"/);
  assert.doesNotMatch(html, /revision|CAS|Vault Key/i);
});

test("EN confirm is fully translated", () => {
  const html = view({ t: en });
  assert.match(html, /not yet sealed as a whole/);
  assert.match(html, /cannot be proven retroactively/);
  assert.match(html, /Update now/);
  assert.match(html, /Later/);
});

test("unknown after reload is visible and blocks Update now", () => {
  const html = view({ blocked: true });
  assert.match(html, /letzte Versuch ist unklar/);
  assert.match(html, /nichts weiter gesendet/);
  assert.match(html, /data-testid="legacy-migration-now"[^>]*disabled/);
  assert.match(html, /data-testid="legacy-migration-later"/);
});

test("decline path is visible and render never starts a migration", () => {
  let migrated = false;
  const html = view({ onMigrate: () => { migrated = true; } });
  assert.match(html, /data-testid="legacy-migration-later"/);
  assert.match(html, /Später/);
  assert.equal(migrated, false, "render must not trigger a migration");
});

test("a result message is shown without hiding the remaining choice", () => {
  const html = view({ message: "Der Ausgang ist unklar." });
  assert.match(html, /data-testid="legacy-migration-message"/);
  assert.match(html, /Der Ausgang ist unklar/);
  assert.match(html, /Später/);
});
