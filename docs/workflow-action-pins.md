# Workflow action source binding (H5)

Every external `uses` entry in the five repository workflows names a complete
40-character commit SHA. Human-readable previous refs remain in comments.
Existing immutable desktop-action pins are preserved. The other refs were
resolved through the upstream repositories' GitHub commit API on20October2026;
their action manifests were fetched at those exact commits and inspected.
This binds action source, without changing workflow permissions, credentials,
release triggers, checks or the package installation path.

When updating an action, resolve the intended upstream ref, inspect the exact
action manifest and its nested actions, change the full SHA, and verify the
resulting workflow on GitHub. A comment showing a version or branch is only
review context; the executed reference is its commit. This change does not
add a new YAML parser or dependency to the project.

## Pages artifact

The upstream pinned `upload-pages-artifact` composite still invokes a mutable
`actions/upload-artifact@v4` internally. Merely pinning its outer commit would
leave that action reference mutable. The Ubuntu Pages job instead runs the
same GNU tar archive format through `scripts/package-pages.sh`, then directly
uses the already-pinned upload action. Name `github-pages`, one-day retention,
archive filename and missing-file failure remain the same. The packaging step
also runs against the real site in ordinary CI; it does not deploy the site.
Pages deployment retains its existing main/workflow-dispatch trigger and
configuration gate. Product download links and site content are unchanged.

Upstream format:
[upload-pages-artifact/action.yml at56afc609](https://github.com/actions/upload-pages-artifact/blob/56afc609e74202658d3ffba0e8f6dda462b719fa/action.yml).

## Remaining boundaries

A SHA-pinned action can still download external software. Rust stable, the
selected Node/Python release lines, cargo tool installs, audit databases,
CodeQL bundles, Gitleaks binaries, package registries, PostgreSQL image tags and
hosted runner images retain their existing version/update policies. The Rust
action's upstream installer download also remains outside this source-binding
claim. No complete hermetic/reproducible supply-chain or runtime sandbox claim
follows from H5. Dependency locks, checksum-bound packagers, release artifact
provenance, installed bytes, update trust and H4/H6 remain separate checks.

GitHub PR CI executes the selected action sources before integration. Pages
deployment and a new desktop package need their own actual run receipts;
changing these workflow references does not itself certify a release.
