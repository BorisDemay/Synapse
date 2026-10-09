---
name: synapse-security
description: Secure E2EE, auth, storage, and client secrets.
version: 0.1.0
author: Project maintainer, Hermes Agent
license: AGPL-3.0-or-later
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [synapse, security, e2ee, authentication, rust]
    related_skills: []
---

# Synapse Security

Use this skill for any change that crosses a trust boundary: cryptography, authentication, browser persistence, storage, HTTP, logs, configuration, permissions, Docker, or Tauri capabilities. It defines constraints; it does not replace a focused security review.

## When to Use

- Adding or changing `crates/synapse-crypto/`, authentication, sessions, blobs, sync payloads, browser storage, logging, metrics, HTTP middleware, Docker, or Tauri permissions.
- Reviewing a feature that might expose note contents, keys, tokens, file paths, or user identity.
- Do not use it as permission to invent an E2EE sharing or recovery protocol; those features are outside the MVP.

## Security Contract

- The server is an opaque synchronisation service. It receives ciphertexts, nonces, ciphertext hashes, revisions, operation IDs, cursors, authorization metadata, and encrypted key envelopes only.
- Markdown, note names, paths, tags, wikilinks, previews, attachments, search terms, and plaintext hashes remain client-side.
- A random 256-bit vault key encrypts content with XChaCha20-Poly1305. Derive the wrapping key locally with Argon2id and unique persisted salts. Bind ciphertext to its vault, note, and revision through versioned AAD.
- Never expose keys or plaintext through debug formatting, errors, URLs, browser persistent state, analytics, metrics, logs, traces, or server APIs.
- The server password verifier and local key-wrapping derivation use separate salts and domain-separated contexts. Never send a wrapping key or raw password to an API.
- Use maintained cryptographic libraries; no custom algorithms, nonce generation, formats, or randomness.

## Procedure

1. Read the relevant Task 11a, 12, 14, 16, 17, 19, 23, 24, or 26 in the implementation plan. Completion: every boundary and intended invariant is known.
2. Write a focused failing test first: tampering, wrong credential, wrong AAD, stale authorization, traversal, accidental serialization, or secret redaction. Completion: failure proves the missing protection.
3. Implement the minimum behind a typed boundary. Completion: server-facing interfaces accept ciphertext, not plaintext.
4. Test error paths and capture logs/telemetry. Completion: the test fixture’s plaintext, passwords, tokens, and keys are absent.
5. Run the targeted suite, its integration suite, static checks, and dependency/license checks. Completion: actual output is clean.
6. Document a changed threat, limitation, migration, or recovery effect under `docs/security/`. Completion: a future operator can understand the risk.

## Pitfalls

- E2EE prevents server-side full-text search, preview generation, and automatic content merge. Keep those operations on an unlocked client.
- Encryption does not hide all metadata: traffic timing, ciphertext sizes, membership, revisions and IP data remain observable to a server operator. Do not claim otherwise.
- A forgotten secret cannot be recovered without a separately designed recovery mechanism. Do not add server escrow implicitly.
- IndexedDB is not a secret vault. Cache ciphertexts only and purge in-memory keys on lock/logout.
- A successful unit test is insufficient for auth, file paths, or headers; add integration coverage against the real HTTP/DB boundary.

## Verification

Run the exact task-specific tests, then at least:

```text
cargo nextest run -p synapse-crypto -p synapse-server
cargo clippy --workspace --all-targets -- -D warnings
cargo deny check
pnpm audit --prod
```

Before declaring completion, verify no test logs, JSON payloads, database fixtures, browser persistence, or blob files contain the plaintext fixture or a vault key.
