# Future compatibility check

Use this on **every** change that touches crypto, vault schema, access, devices, or sync.  
Copy the list into the PR / review. Default stance: the running protocol wins.

Vision: [`future-architecture.md`](future-architecture.md).  
Do **not** implement that vision in the same PR as a password-manager fix.

## Scoring

| Mark | Meaning |
|---|---|
| **PASS** | Does not assume a closed future. Leave a door (version field, opaque blob, envelope type). |
| **WARNING** | Couples something that later work will have to unwind. Say what. |
| **BLOCK** | Hard-codes a lie (plaintext on the server, User=Human as crypto, DNA as key, Team=PAM). Do not ship. |

## Questions

- [ ] Does this assume only humans?
- [ ] Does this assume only passwords?
- [ ] Does this assume one vault?
- [ ] Does this assume one device?
- [ ] Does this assume online connectivity?
- [ ] Does this assume one provider?
- [ ] Does this hard-code an identity model (e-mail as crypto)?
- [ ] Does this hard-code a crypto algorithm without `cryptoVersion`?
- [ ] Does this prevent scoped capabilities?
- [ ] Does this prevent vault-to-vault connections later (e.g. “there can be only one VK forever, no new envelope `type`”)?
- [ ] Does this make Mobile harder later (vault format / sync tied to Tauri)?
- [ ] Does this make Agent Identity harder later (agent = free-text forever, FastAPI mints tokens)?
- [ ] Does this make PQC migration harder later?
- [ ] Does this create a separate Team architecture / PAM?
- [ ] Does this unnecessarily expose plaintext (logs, review UI, FastAPI, broker)?

## Anti-patterns (BLOCK unless the PR is deleting them)

- User == Human (as a crypto fact)
- Agent == String (as the *final* identity; today’s `application: "n8n"` is an admitted v1 limit)
- Credential == Password
- Vault == Database
- Device == Desktop
- Sync == File Copy of plaintext
- Permission == Boolean (all-or-nothing vault)
- Identity == Email
- Crypto == hard-coded algorithm with no version
- Team == separate product
- Browser == hard-coded browser names as trust
- Central plaintext broker
- DNA / biometrics as the wrapping secret

## Result

```text
PASS | WARNING | BLOCK
Notes:
```
