## 10. Memory & Lock Lifecycle

### State Machine
```
LOCKED  →  UNLOCKING  →  UNLOCKED  →  LOCKING  →  LOCKED
```

### Rules
- Master Password exists in memory only during the short derivation window, then is zeroized.
- Vault Key and all plaintext entry data exist only in the `UNLOCKED` state.
- On any transition to `LOCKED` (manual Lock button; extension idle) all sensitive material must be zeroized as thoroughly as the platform allows. The PWA and `4AllPass.app` do **not** auto-lock on idle, a hidden tab, or sleep.
- The OS clipboard is outside this machine. If the client copies a secret (entry password, recovery key), it must overwrite the clipboard after 30 seconds **if the clipboard still holds that value**, and try again on lock. If it cannot read the clipboard, it must not clobber it.

**Note:** JavaScript / WASM environments cannot provide perfect memory erasure guarantees. This is documented in the threat model and accepted as a platform limitation. Other apps may have already read the clipboard before the overwrite.

### Auto-Lock Triggers
- PWA and desktop app: **manual Lock only**. Sleep, screen lock, tray hide, inactivity, a hidden tab, and switching to the browser do **not** lock. (App Nap + a 5s wall-clock stall used to look like sleep.)
- Extension: 5-minute idle lock (popup close does **not** lock, so a fill shortcut can still run). Worker eviction also drops in-memory plaintext.
- Mobile app backgrounded (when that client exists)

---
