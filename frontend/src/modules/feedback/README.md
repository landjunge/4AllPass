# Feedback module

Owns the global error and notice model used by the app banner.

- User text is selected from a fixed bilingual catalog.
- Technical classification contains only an allowlisted error name and an
  optional HTTP status.
- Raw messages, response bodies, stacks, identifiers, and submitted values are
  never copied into feedback state.
- The module does not log failures and does not own account, vault, or crypto
  behavior.

Other code imports only from `modules/feedback/index.ts`.
