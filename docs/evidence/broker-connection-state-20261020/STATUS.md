# E05 prerequisite: truthful optional broker connection status

Base `45331a3`, 20 October 2026. One existing frontend helper/component slice,
independently reviewed by a different native Codex agent. No Grok quota used.
No backend, broker token, service, grant, package or installed app changed.

Initial nine synthetic transport/race cases: five failed / four passed against the old helper.
After correction 10/10 including successful retry; review independently found
one reentrant status-listener disconnect case. Its unchanged private repro now
passes, and the checked-in targeted suite has 11/11. The reviewer reports ship.
Existing frontend workspace had 212/212 before that final guard; a fresh full run
of the final files passed 213/213, with no skips. Final frontend typecheck and
lint passed (12 existing warnings in untouched files).

Actual LocalBrokerConnect + CopyModeProvider in fresh Chromium contexts:
8/8 across DE/EN (pending response, accepted 204, disconnect, denied 403), zero
page errors. Synthetic replies were intercepted inside the page; no broker
network request, personal browser profile, account, vault or native setup used.
The component maps errors to plain DE/EN guidance.

The status only records last observed transport availability. It proves no
fresh expected suite peer, user/vault binding or unlocked vault; it cannot be
used for the shared bar ring/pulse. The current blocked machine-access surface
is unchanged. Full UI01 requires the separate asset/status/open adapter work.

Private detailed red/green/reviewer/browser logs remain in the existing
continuation evidence directory. Rerunnable targeted command:
`node --import tsx --test frontend/src/lib/local-broker-client.test.ts`.
