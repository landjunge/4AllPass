import { createElement, type ReactNode } from "react";
import type { Line } from "../../lib/copy-mode.ts";

export const WARNING: Line = {
  de: "Dieser Tresor ist älter und noch nicht als Ganzes versiegelt. Beim Aktualisieren wird der aktuell geöffnete Inhalt für die Zukunft mit einer Integritätsprüfung versehen. Der bisherige Serverstand lässt sich nicht nachträglich beweisen. Eine verschlüsselte Sicherung wird vorher lokal abgelegt.",
  en: "This vault is older and not yet sealed as a whole. Updating seals the currently opened content with an integrity check for the future. The previous server state cannot be proven retroactively. An encrypted backup is stored locally first.",
};

export const BLOCKED: Line = {
  de: "Der letzte Versuch ist unklar. Es wird nichts weiter gesendet, bis der Ausgang positiv belegt ist.",
  en: "The last attempt is unknown. Nothing further is sent until the outcome is positively proven.",
};

/** Pure presentational banner; the container owns the app context/actions. */
export function LegacyMigrationBannerView({
  legacy,
  blocked,
  busy,
  message,
  t,
  onMigrate,
  onLater,
}: {
  legacy: boolean;
  blocked: boolean;
  busy: boolean;
  message: string | null;
  t: (line: Line) => string;
  onMigrate: () => void;
  onLater: () => void;
}): ReactNode {
  return createElement(
    "div",
    { className: "banner notice", "data-testid": "legacy-migration-banner", role: "status" },
    createElement(
      "span",
      null,
      legacy ? t(WARNING) : null,
      blocked && !message
        ? createElement("span", { "data-testid": "legacy-migration-blocked" }, " ", t(BLOCKED))
        : null,
      message
        ? createElement("span", { "data-testid": "legacy-migration-message" }, " ", message)
        : null,
    ),
    legacy
      ? createElement(
          "button",
          {
            type: "button",
            className: "secondary",
            "data-testid": "legacy-migration-now",
            disabled: busy || blocked,
            onClick: onMigrate,
          },
          busy
            ? t({ de: "Einen Moment…", en: "One moment…" })
            : t({ de: "Jetzt aktualisieren", en: "Update now" }),
        )
      : null,
    createElement(
      "button",
      {
        type: "button",
        className: "link",
        "data-testid": "legacy-migration-later",
        onClick: onLater,
      },
      t({ de: "Später", en: "Later" }),
    ),
  );
}
