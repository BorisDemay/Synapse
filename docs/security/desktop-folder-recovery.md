# Desktop folder recovery

The shared IndexedDB ciphertext cache is canonical. Desktop mirrors completed
save/load actions to a chosen Markdown directory. Locking purges vault keys;
it does not remove the plaintext Markdown replica.

A manifest at `attachments/.synapse-mirror.json` binds the directory to its
opaque vault ID and tracks local content hashes. These paths/hashes never go to
the server. A different vault cannot adopt that directory. Unknown files and
externally changed files are not silently replaced or deleted. Select an empty
directory or explicitly import those files to recover interoperability.

Before replacing any file, the manifest journals both previous and intended
hashes for the validated batch. Reopening can therefore recover on either side
of each interrupted atomic write. Completion narrows the journal; partial
snapshot failure leaves every entry recoverable. Unchanged files are checked
for external edits but are not rewritten. The encrypted cache is retained on any mirror error,
and the UI exposes the error. Case-colliding snapshot paths are rejected on all
platforms to retain Windows/Linux compatibility.

The native picker uses `tauri-plugin-dialog` 2.7.3 (MIT OR Apache-2.0), backed by
`rfd`. Rust's standard library has no OS folder dialog. The plugin is called only
from the closed `choose_local_vault_folder` command. No JavaScript dialog or
filesystem plugin permissions are granted. See the official API documentation:
https://v2.tauri.app/plugin/dialog/ .

Standalone mode uses the existing encrypted envelope and ciphertext formats in
a separate local profile. Entering a server account does not upload that profile;
transfer remains an explicit export/import operation (ADR 0016).
