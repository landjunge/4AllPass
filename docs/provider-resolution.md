# Provider resolution

Local, deterministic. No DNS, no scraping, no AI. Domain ≠ provider ≠ credential type.

```text
URL → normalizeDomain → resolveProvider → { providerId, confidence, matchType }
```

- Exact host or `endsWith("." + host)` — never `endsWith("github.com")` (would match `evilgithub.com`).
- Login hosts like `login.microsoftonline.com` → Microsoft (`known-login-domain`).
- Unknown stays unknown. Heuristic only suggests a possible registrable name (`shop.example.de` → `example.de`), never a provider id.
- User overrides are local, not written into the built-in registry.
- Confidence &lt; 0.95 requires confirmation. Import review shows provider, not passwords.

Package: `@4allpass/providers`. Browser import writes `domain`, `providerId`, `providerConfidence` on `VaultEntry`. The original URL stays. FastAPI never sees this.
