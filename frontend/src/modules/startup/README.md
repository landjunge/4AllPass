# Startup module

Owns the initial health/runtime check and the startup status shown to the app.

- Detects the local profile and reads local-store metadata.
- Restores an existing account session and then asks the vault layer to load
  encrypted vault summaries.
- Keeps the browser-only silent local session separate from the bundled desktop.
- Marks startup ready on both success and handled failure paths.
- Receives no vault plaintext, Vault Key, recovery material, or crypto operation.

Other code imports only from `modules/startup/index.ts`.
