# Eight-week agent access

**Status:** Historical wedge. **Done as a local demo**, not as cryptographic agent identity.

What runs: [local-access-broker.md](local-access-broker.md), [two-minute-demo.md](two-minute-demo.md), [security-boundary.md](security-boundary.md) §7.

Today: `application: "n8n"` is a **string**. Pairing token ≠ agent identity. Grant handoff is **raw secret**; TTL does not un-know a copy already given.

Later (not implemented): [architecture/agent-access.md](architecture/agent-access.md), [specs/maip-v0.1.md](specs/maip-v0.1.md).
