import type { Line } from "../../lib/copy-mode.ts";

/** Desktop settings copy. Launch at login is not vault unlock. */
export const LAUNCH_AT_LOGIN_LABEL: Line = {
  de: "Beim Anmelden starten",
  en: "Launch at login",
};

export const LAUNCH_AT_LOGIN_HINT: Line = {
  de: "Startet die App in der Menüleiste. Der Tresor bleibt gesperrt, bis du das Passwort eingibst. Kein Auto-Allow.",
  en: "Starts the app in the menu bar. The vault stays locked until you enter the password. No auto-allow.",
};

export const LAUNCH_AT_LOGIN_BROWSER: Line = {
  de: "Nur in 4AllPass.app.",
  en: "Desktop app only.",
};

export const SLEEP_LOCK_HINT: Line = {
  de: "Der Tresor bleibt offen, bis du Sperren drückst. Ruhemodus, Bildschirmsperre, Tray und Wechsel in den Browser sperren nicht. Das ist kein FileVault.",
  en: "The vault stays open until you press Lock. Sleep, screen lock, tray, and switching to the browser do not lock. That is not FileVault.",
};

export const LICENSE_HINT: Line = {
  de: "Netzwerkpunkt Personal Use License 1.0. Private, nicht geschäftliche Nutzung kostenlos. Geschäftliche Nutzung, Weiterverkauf und kostenpflichtige Dienste nur mit gesonderter schriftlicher Erlaubnis. Keine allgemeine Weiterverteilung. Deutsch maßgeblich; individuelle Vorlage, kein OSI-Standard und nicht anwaltlich geprüft. Fremdlizenzen und historische Rechte bleiben erhalten.",
  en: "Netzwerkpunkt Personal Use License 1.0. Free private non-business use. Business use, resale and paid services require separate written permission. No general redistribution. German governs; custom terms, not an OSI standard or legal review. Third-party licenses and historical rights remain.",
};

export const UNINSTALL_HINT: Line = {
  de: "Deinstallieren löscht den Tresor nicht still. Ordner: ~/Library/Application Support/4AllPass/ · %APPDATA%\\4AllPass\\ · ~/.local/share/4allpass/.",
  en: "Uninstall does not silently delete the vault. Same folders.",
};
