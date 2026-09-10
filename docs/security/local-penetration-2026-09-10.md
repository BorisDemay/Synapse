# Local penetration assessment — 2026-09-10

Assessed product commit: `6a82954e9cdafb68c555f1ed32f449c39b2ca954`.
No product remediation is included in this assessment.

## Scope and method

User-authorized, bounded adversarial tests against a freshly built Rust API,
an owned disposable PostgreSQL database, synthetic accounts and opaque random
payloads. A headless Chromium browser tested actual cross-origin behavior.
The API and hostile test page bound random loopback ports. Existing Synapse
deployments and development databases were not targeted. The shared local test
PostgreSQL container was used only to create/drop the assessment's own database.

The harness deliberately uses development mode, public signup and non-Secure
cookies on loopback HTTP. It removes inherited Synapse environment settings,
uses directory mail only, and removes its API process, database, mail and blobs
afterward. No credentials or session values appear in the report.

Final run: **29 checks: 20 PASS, 5 FINDING, 4 OBSERVATION**. The five failing
checks represent **three distinct vulnerabilities**, with raw HTTP/WebSocket
and browser tests providing overlapping evidence. All seven existing harness
lifecycle tests also passed. Exit status 0 from the assessment means execution
completed, not that the application passed every security check.

## Confirmed vulnerabilities

### P1 — Direct API authentication throttling bypass

Eight invalid login requests with the same `X-Forwarded-For` returned
`401,401,401,401,401,429,429,429`. Eight requests rotating that untrusted header
all returned `401`, demonstrating fresh limiter buckets without changing the
TCP source. This is a throttling bypass, not a successful password compromise.

Root: `apps/server/src/lib.rs`, `ClientKeyExtractor`, trusts forwarding headers
without authenticating the proxy. `main.rs` also does not install the connection
information expected by the fallback. The Caddy/proxy path was not tested; its
header handling can reduce exposure when direct API access is unavailable.

Remediation: use actual peer addresses, explicitly configure trusted proxies,
and test both direct and proxied traffic with forged forwarding headers.

### P2 — Cross-origin authenticated WebSocket accepted

A raw hostile-Origin handshake returned HTTP 101. Chromium then opened an
authenticated socket from a different loopback port, despite a `SameSite=Strict`
HttpOnly session cookie. Different ports are different origins but the same
site. The browser used its cookie automatically; page JavaScript was not given
the session value.

Prerequisites: victim has a valid session, attacker controls an origin on the
same site and knows the vault UUID. The test provisioned that UUID explicitly;
it did not demonstrate UUID discovery. This does not establish exploitability
from an arbitrary unrelated website, nor a production HTTPS deployment test.

Root: `apps/server/src/http/ws.rs`, `connect`, lacks an Origin allowlist check.
Remediation: validate handshake Origin against the configured trusted origins,
with explicit policy for any supported non-browser clients.

### P2 — Logged-out WebSockets retain access to activity notifications

Opened a socket, logged out its session, confirmed `/v1/session` returned 401,
then pushed an operation through a separate still-valid session. Both the raw
socket and the hostile browser received the new vault/cursor notification.

Impact demonstrated: vault activity and cursor metadata remain observable after
logout. No note plaintext or encryption key was disclosed. HTTP access with the
revoked session was correctly denied; cursor possession alone was not shown to
bypass HTTP authorization.

Root: `apps/server/src/http/ws.rs`, `serve`, retains user/vault identifiers but
does not track session revocation. Remediation: associate sockets with sessions,
close them on revocation/logout, and revalidate session expiry and membership.
Add real-socket regression tests, including password change and membership loss.

## Observations, not demonstrated exploits

1. **Development account:** `test` / `test` authenticated in the explicitly
   development-mode harness. This confirms a deployment hazard when development
   settings are exposed; it is not a production-mode authentication bypass.
2. **Vault creation and sync push Origin enforcement:** forged-Origin JSON
   requests carrying a valid cookie succeeded with 201. However, a real browser's
   hostile JSON fetch was blocked by CORS and text/plain creation returned 415.
   Add consistent Origin checks, but this run did not prove browser CSRF on these
   mutations.
3. **Changed-payload operation replay:** reusing an operation ID with a changed
   nonce returned 201 and the original durable acknowledgment. A subsequent pull
   confirmed the original nonce was preserved. ADR 0002 specifies durable replay;
   no overwrite or data loss was demonstrated. Rejecting non-identical payloads
   under an existing ID is a possible protocol hardening change, requiring ADR
   review rather than treating current behavior as a proven integrity exploit.

## Controls that held

- Unauthenticated vault, envelope and operation reads returned 401.
- Cross-account vault/envelope/operation reads, pushes, envelope overwrites and
  WebSocket access returned 404.
- Envelope updates rejected hostile Origin with 403.
- CORS did not authorize hostile origins; Chromium blocked hostile JSON fetch.
- A simple text/plain mutation was rejected with 415.
- Identical operation replay preserved its revision.
- Incorrect ciphertext hash and invalid/injection-shaped pull limits returned 400.
- HTTP rejected the logged-out session with 401.

These are individual tested controls, not a general proof of authorization,
SQL injection resistance, cryptographic security or absence of data loss.

## Reproduction

From the repository root, with the existing Rust/Node dependencies, Docker and
Playwright Chromium installed:

```sh
node tests/security/local-penetration.mjs
node --test tests/harness/*.test.mjs
```

Machine-readable observations: `target/security/local-penetration.json`
(generated, not committed). The script accepts no external target URL and caps
its explicit HTTP probes at 90. Browser and WebSocket probes are a fixed small
set. Setup/control failures terminate the run rather than masquerading as a
successful assessment. The JSON is written only after cleanup succeeds.

## Limits and next tests

This is a focused local application assessment, not a comprehensive external
penetration test. It did not test production TLS/Caddy, Windows/Tauri exploitation,
dependency vulnerabilities, Markdown XSS, browser storage extraction, session
expiry, password-change races, SMTP, restore attacks, or cryptographic attacks.
No brute-force password search, volume exhaustion, high-concurrency load,
destructive fuzzing or live third-party calls were performed. Large-pull memory
amplification remains a source-review concern, not a demonstrated DoS result.

Prioritize proxy-aware throttling, WebSocket Origin validation and live session
revocation. Retest the same scenarios after fixes, then expand to rendering,
cross-tab secret lifecycle, bounded resource exhaustion and deployment controls.
