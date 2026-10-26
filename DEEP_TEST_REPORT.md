# Deep testing checkpoint — 2026-10-26

Deep testing mein actual chat delivery, session revocation, attachment download aur concurrent message retry defects reproduce aur fix hue. Yeh development checkpoint hai: platform-wide tenancy, Ultra Admin, provider aur device verification abhi unfinished hain.

## Measured results

| Check | Final result | Evidence |
| --- | --- | --- |
| Full isolated staff/security run | 1271/1271 passed across 30 files; 0 failed; 0 skipped; process exit 0 | [Per-case CSV](build/deep-testing/results.csv), [JSON including source hashes](build/deep-testing/results.json) |
| New deep chat tests | 35/35 passed, included in full run above | [Tests](backend/staff-tests/deep-chat.security.test.js), [targeted run](build/deep-chat-after.log) |
| Existing 100-case misuse audit, rerun | 100/100 passed | [Per-case results](build/security-audit/results.csv), [original audit explanation](SECURITY_AUDIT_100.md) |
| Backend fixtures/unit regression | 106/106 passed | [Log](build/deep-testing-backend.log) |
| Mobile Jest | 9 suites; 60/60 passed | [Log](build/deep-testing-mobile.log) |
| Backend TypeScript | Passed (`npm run build`) | [Log](build/deep-testing-types-backend.log) |
| Mobile TypeScript | Passed (`tsc --noEmit`) | [Log](build/deep-testing-types-mobile.log) |
| Project ESLint | 0 errors; 51 warnings | [JSON](build/deep-testing-eslint.json) |
| Android production JavaScript bundle | Passed; 65 assets copied | [Log](build/deep-testing-bundle.log) |

Counts overlap: the full run includes the 35 new deep tests and some of the 100-case audit. Do not sum them as distinct scenarios. Source hashes for auth/chat production files were unchanged throughout the full run. Lint warnings remain; two are in new code (`no-void` and test-helper `no-shadow`).

## What was reproduced and changed

Before fixes, the first 30 deep tests produced **10 passes and 20 failures**, no skips ([baseline log](build/deep-chat-before.log)). These are failing assertions grouped into defects, not 20 independent vulnerabilities. Cases 31–35 were added afterward and have no pre-fix baseline.

1. **Persisted chat messages were not broadcast through production wiring.** The default HTTP publisher discarded its conversation argument. It now forwards both arguments. A positive end-to-end test uses the production application factory, default HTTP route wiring, real local WebSockets and owned MongoDB, so a custom test publisher cannot hide the defect.
2. **Open sockets retained stale authentication.** Shared session validation now checks expiry/revocation, both account active flags, unique canonical/legacy identity resolution, mapped school availability and branch/school consistency. WebSockets bind the original identity and session privately, validate on authentication, each application frame and each protected delivery, and recheck after conversation authorization. Idle sockets are checked every 15 seconds by default; tests use 250 ms. Role/identity changes require authentication again. A deterministic interleaving verifies logout committed during recipient authorization prevents delivery.
3. **Canonical references broke valid recipients.** Teacher, branch and verified Parent-child ObjectId references now use the existing reference adapter; legacy aliases remain supported. Broken unrelated Parent references no longer suppress other authorized recipients. Per-socket conversation authorization remains enforced.
4. **Real MongoDB image downloads returned 404.** Stored BSON Binary is read with Buffer promotion. A multipart PNG is uploaded, retrieved via the authenticated endpoint and compared byte-for-byte using native MongoDB storage.
5. **Concurrent text-message identity reuse produced incorrect responses.** Identical text retries persist one message and emit once. Changed text payloads or cross-conversation identity collisions return 409. Concurrent text-message duplicate insertion is resolved by reading the winner and verifying its conversation/body/attachment state instead of surfacing a duplicate-key 500. Attachment-upload retries retain their existing return-previous-message contract; changed binary payload identity and orphan cleanup were not tested here.
6. **Protocol/session defenses expanded.** Authentication state is reserved before asynchronous work; overlapping authentication cannot register a closing socket. Null session identities fail closed. Binary, malformed, oversized and arbitrary subscribe frames are rejected. Send queues at or above 1 MiB close with 1013; this is a deterministic bounded-queue check, not proof of production capacity.

Production changes: [shared authentication](backend/src/auth.js), [chat HTTP routes](backend/src/chatRoutes.js), [realtime authorization/delivery](backend/src/chatRealtime.js). Added [deep test runner](backend/scripts/run-deep-tests.js), [structured reporter](backend/scripts/deep-test-reporter.js), [35-case suite](backend/staff-tests/deep-chat.security.test.js), and `npm run test:deep` in [backend package](backend/package.json). No Student, Parent or Finance component was converted to TypeScript.

## New case matrix

| ID | Scenario | Before | After |
| --- | --- | --- | --- |
| DEEP-01 | production HTTP publisher delivers the persisted message through default wiring | FAIL | PASS |
| DEEP-02 | direct publisher positive control delivers to a currently authorized socket | PASS | PASS |
| DEEP-03 | canonical ObjectId branch values retain realtime delivery | FAIL | PASS |
| DEEP-04 | native teacher identity without a legacy alias can authenticate and receive | FAIL | PASS |
| DEEP-05 | canonical parent-child ObjectId references retain authorized delivery | FAIL | PASS |
| DEEP-06 | logout after socket readiness prevents further protected delivery | FAIL | PASS |
| DEEP-07 | expired session after readiness cannot receive a protected event | FAIL | PASS |
| DEEP-08 | active disable after readiness closes the session | FAIL | PASS |
| DEEP-09 | isActive disable after readiness closes the session | FAIL | PASS |
| DEEP-10 | school suspension after readiness prevents protected delivery | FAIL | PASS |
| DEEP-11 | branch school mismatch after readiness invalidates the socket | FAIL | PASS |
| DEEP-12 | changed role after readiness requires fresh authentication | FAIL | PASS |
| DEEP-13 | idle revoked socket is closed without waiting for a new chat message | FAIL | PASS |
| DEEP-14 | account disabled between ticket issuance and socket open is denied | FAIL | PASS |
| DEEP-15 | school suspended between ticket issuance and socket open is denied | FAIL | PASS |
| DEEP-16 | ambiguous native ID and legacy alias cannot redeem a socket ticket | FAIL | PASS |
| DEEP-17 | twenty simultaneous ticket redemptions have exactly one winner | PASS | PASS |
| DEEP-18 | overlapping authentication frames fail closed before readiness | PASS | PASS |
| DEEP-19 | malformed WebSocket JSON closes with a protocol error | PASS | PASS |
| DEEP-20 | oversized WebSocket frames are rejected before application handling | PASS | PASS |
| DEEP-21 | revoked parent-child relationship cannot receive further conversation data | PASS | PASS |
| DEEP-22 | revoked teacher assignment cannot receive further conversation data | PASS | PASS |
| DEEP-23 | logout committed during recipient authorization wins before delivery | FAIL | PASS |
| DEEP-24 | image attachment round-trips through real MongoDB binary storage | FAIL | PASS |
| DEEP-25 | twenty simultaneous identical message retries persist one message and emit once | FAIL | PASS |
| DEEP-26 | changed message payload cannot silently reuse an idempotency identity | FAIL | PASS |
| DEEP-27 | concurrent cross-conversation message identity collision returns a clean conflict | FAIL | PASS |
| DEEP-28 | history pagination keeps identical timestamps stable without duplicates or omissions | PASS | PASS |
| DEEP-29 | clients cannot subscribe to arbitrary conversation identifiers | PASS | PASS |
| DEEP-30 | readiness payload exposes no bearer or session hash | PASS | PASS |
| DEEP-31 | bounded send queue closes a slow consumer instead of accumulating data | Not baselined | PASS |
| DEEP-32 | binary application frames cannot bypass the text JSON protocol | Not baselined | PASS |
| DEEP-33 | corrupted null session identity cannot match an alias-free native user | Not baselined | PASS |
| DEEP-34 | legacy parent-child aliases retain authorized realtime delivery | Not baselined | PASS |
| DEEP-35 | unrelated broken Parent references do not suppress other authorized recipients | Not baselined | PASS |

## Test boundaries and remaining work

- New chat tests use real HTTP, real WebSockets, production route wiring and a native disposable MongoDB replica set. Only database connection/configuration is replaced to ensure ownership; selected race tests use a database proxy to force a specific interleaving. Test-only synthetic records exist solely in disposable owned databases, never the configured database.
- The broad isolated suite mixes fixture/unit checks and real replica-set transaction/race tests across staff roles, assignments, approvals, attendance, results and other existing modules. Backend and mobile unit results do not substitute for device or provider tests. The runner excludes historical tests that load configured database credentials, sets an invalid database sentinel, and disables live/payment flags.
- Twenty concurrent ticket redemptions and message retries were checked. No sustained load, bandwidth saturation, soak, multi-instance fanout or durable realtime delivery/outbox verification was performed. Session revalidation cannot recall bytes already queued or delivered and is not a proof of all possible concurrent authorization interleavings.
- **Platform-wide school isolation remains unfinished.** These fixes cover the exercised chat/shared-session paths for mapped identities. Other raw/Mongoose access, legacy unmapped users, files, background jobs, exports and write races still need a complete tenant audit. Do not guess school/branch mappings or claim global isolation from this report.
- **Ultra Admin remains unfinished.** Controlled bootstrap, school provisioning, invitations, platform permissions, suspension, plans, limits and audit still need implementation after the tenant boundary is proved.
- Live streaming and online payments remain disabled. Existing standalone classroom tests do not prove integrated shared opaque-session/provider flows or Parent invitation delivery. ZEGO sandbox credentials and provider verification, an officially chosen hosted payment gateway and school settlement policy are external requirements.
- Android JavaScript bundling passed. Native Android installation, physical-device role workflows, PDF share/print, Urdu font/layout rendering and real provider delivery remain unverified. No APK was generated.
- Process-local login throttling and best-effort realtime fanout remain architectural limits. The earlier development backlog in [AI_STUDIO_REMAINING.md](AI_STUDIO_REMAINING.md) is still open.

## Preservation and rerun

Affected originals were compared by SHA-256 before promotion and backed up at `build/local-backups/deep-testing-20261026`. Unexpected concurrent changes abort promotion. Existing environment secrets and live MongoDB configuration were preserved, and no configured server/database was started. No push, deployment, payment transaction or APK build occurred.

Run `npm run test:deep` from `backend` with the real Node installation on PATH. It selects the safe allowlisted suites, runs serially with `tsx`, records every result under `build/deep-testing`, rejects skips/failures and verifies tracked source files remained unchanged. Other checks: backend `npm test` / `npm run build` / `npm run test:security:100`; root `npm test -- --runInBand`, `tsc --noEmit`, `npm run lint` and React Native Android JS bundling.
