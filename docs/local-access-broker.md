# Local access broker — current source

**DE:** Maschinenzugriff ist gesperrt. `POST /v1/access/request` verweigert nach
den vorhandenen Token-/Originprüfungen `handoff_unavailable`, auch nach einem
alten Allow. Kein `raw_secret`-Fallback; kein `access_token` an die KI. Die
menschlichen Tresor-, Import-, Autofill- und Recovery-Wege bleiben erhalten.

**EN:** Machine access is blocked. Following existing token/origin checks,
`POST /v1/access/request` returns `handoff_unavailable`, including old Allow
responses. No `raw_secret` fallback or credential-bearing `access_token` is
returned to AI consumers. Human vault, import, autofill and recovery remain.

The Python sidecar and development Node relay remain separate from vault
cryptography. Pairing tokens are not agent identity. Neither this source change
nor a grant TTL recalls credentials or provider sessions previously disclosed.
Historical releases retain their original behavior; no package was rebuilt.

The protected API core is not a production access service. See
[security-boundary.md §7](security-boundary.md#7-machine-access-fail-closed)
and [PROTECTED-ACCESS-20261018.md](PROTECTED-ACCESS-20261018.md) for the fixed
synthetic contract, actual TollGate adapter, checks and missing OS boundary.
Do not use the old n8n secret-receiving recipes as a workaround.
