# P06 native temporary-copy cleanup — 20 October 2026

Independent review reproduced two actual source counterexamples: a file
symlink and a directory symlink inside an owned synthetic temp tree caused
`shred_tree` to overwrite an external private fixture with zero bytes. No real
browser, Keychain, vault or project was read. This requires local manipulation
of the owner-only temp tree, not a demonstrated remote attack.

Remove the custom `metadata`/`is_dir`/`write` walk. The existing two browser
import callers now use standard-library tree removal through the same helper,
without content overwrites or file-sized zero-buffer allocation. Rust documents
[no-follow removal and supported-platform race protections](https://doc.rust-lang.org/std/fs/fn.remove_dir_all.html).
No new dependency, browser path, import authorization or crypto operation.

Six actual Mac/Rust tests pass: private-directory mode, ordinary nested removal,
external file symlink, directory symlink, root symlink and hardlink preservation.
The same standalone module runs in the existing Linux desktop-unit CI job.
Independent final review and CI remain pending.

Deletion remains best-effort and cannot establish physical erasure of copies,
snapshots or SSD blocks. Same-user administration is not isolated. This does
not add an export/import policy or claim a new built/installed app. Historical
helper name remains for its existing callers; its documented contract is removal.
