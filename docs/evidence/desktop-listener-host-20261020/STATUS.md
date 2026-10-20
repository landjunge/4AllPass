# Desktop listener discovery repair

The actual private normal-startup probe on base `e9b6f64` started its own
same-source packaged sidecar on127.0.0.1:8788, but the normal45s ownership
wait expired before opening the UI. The child was cleaned up and the port freed.

`lsof -iTCP:127.0.0.1:PORT` is rejected as an unacceptable port specification
on this Mac (lsof4.91). The host delimiter is `@`. The single-character runtime
repair lets the existing observer obtain the listener PID; it does not replace
PID ancestry with TCP health or bypass occupied-port refusal.

Own checks, macOS Intel:

- New real ephemeral listener test against the unchanged observer:7 passed,
  1 failed (`None` instead of own PID). After the repair:8/8 passed.
- Existing `core_bind.rs` policy tests:13/13 passed.
- Private harness using the real `loopback.rs` / `process_inspect.rs`: actual
  listener accepted for its owning PID, rejected for a foreign ancestor ID;
  the same existing synthetic listener remained alive. No process was reaped.
- The ordinary native-startup test-only occupied8788 restriction had already
  refused an own synthetic listener before sidecar spawn/data creation.
  Its full normal UI journey is a separate test slice and not claimed here.

No real profiles, product database, installed app or foreign process was used.
No dependency or ownership-policy change. The regression directly exercises
the OS command, rather than only parsing fabricated `lsof` output.
