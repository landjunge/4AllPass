/**
 * Desktop settings copy. Launch at login is not vault unlock.
 */

export const LAUNCH_AT_LOGIN_LABEL = "Beim Anmelden starten / Launch at login";

export const LAUNCH_AT_LOGIN_HINT =
  "Startet die App in der Menüleiste. Der Tresor bleibt gesperrt, bis du das Passwort eingibst. Kein Auto-Allow. / Starts the app in the menu bar. The vault stays locked until you enter the password. No auto-allow.";

export const LAUNCH_AT_LOGIN_BROWSER =
  "Nur in 4AllPass.app. / Desktop app only.";

export const SLEEP_LOCK_HINT =
  "Der Tresor bleibt offen, bis du sperrst oder der Rechner in den Ruhemodus geht. Bildschirmsperre, Tray und Wechsel in den Browser sperren nicht. Das ist kein FileVault. / The vault stays open until you lock or the computer sleeps. Screen lock, tray, and switching to the browser do not lock. That is not FileVault.";

export const UNINSTALL_HINT =
  "Deinstallieren löscht den Tresor nicht still. Ordner: ~/Library/Application Support/4AllPass/ · %APPDATA%\\4AllPass\\ · ~/.local/share/4allpass/. / Uninstall does not silently delete the vault. Same folders.";
