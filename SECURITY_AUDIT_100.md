# 100-case security and misuse audit — 2026-10-26

## Khulasa

100 named cases test kiye gaye: **100 PASS, 0 FAIL, 0 NOT VERIFIED**. Yeh isolated API/service audit hai; live users, real database records, payments, provider services aur Android device par attacks nahi kiye gaye.

40 naye adversarial cases ke pehle run mein **24 pass / 16 fail** hue. Woh 16 failures neeche diye gaye 6 defect groups se related thay. Fixes ke baad wohi cases 100-case matrix ka hissa hain. Baqi 60 existing adversarial/regression cases ko isi audit mein dobara execute kiya gaya. 100 test cases ka matlab 100 discovered vulnerabilities nahi hai.

**Passing these selected cases does not prove platform-wide tenancy or production readiness.** Remaining unscoped paths and deployment requirements are listed below.

## Results and evidence

| Check | Result |
| --- | --- |
| Exact named audit matrix | 100/100 passed; 0 failed; 0 unverified; process exit 0 |
| Before-fix new-case baseline | 40 executed: 24 passed / 16 failed |
| Backend regression suite | 106 passed, zero failures |
| Backend TypeScript / source lint | Backend build passed; full lint: 0 errors / 49 warnings |
| Mobile/device/provider verification | No mobile source changed in this audit; device/provider tests were not run |

Machine-readable evidence:

- `backend/security-audit-100.json`: exactly 100 unique named cases and their test files.
- `build/security-audit/events.jsonl`: structured Node test events from the final matrix run.
- `build/security-audit/results.json` and `results.csv`: per-case results, execution time and evidence type.
- `build/security-audit-before.log`: before-fix failures, using owned fixture data only.
- `build/security-audit-backend-regression.log`: wider backend regressions.
- `build/security-audit-eslint.json`: source lint details.

The runner fails if a named case is missing, skipped, duplicated or fails. Fixture tests are explicitly distinguished from real isolated MongoDB/HTTP tests. No browser/device result is inferred from API tests.

The first custom-reporter attempt required a Windows file URL correction. An intermediate run also had setup-hook failures; those runs were not accepted as successful evidence. The report uses the final measured matrix result.

## Reproduced defects and fixes

| Finding | Severity | Before | Cases | Fix |
| --- | --- | --- | --- | --- |
| F-01 | Medium | Oversized credentials reached database/password processing | SEC-010 | Credential bounds now run before database lookup: email <=320 characters; password <=1024 UTF-8 bytes. |
| F-02 | High | No sign-in attempt throttling | SEC-011, SEC-012 | Added bounded process-local account/source limits, Retry-After, forwarding-header resistance, expiry and successful-login refunds. |
| F-03 | Medium | Malformed/oversized JSON returned 500; raw parser error messages could reach logs | SEC-013, SEC-014 | Sanitized 400/413 responses; no raw parser/driver messages or credentials in request/startup/health logs. |
| F-04 | High | School administrators could access global branch data; new branches lacked trusted school ownership | SEC-015, SEC-016, SEC-017, SEC-018, SEC-021, SEC-026 | Integrated branch list/detail/create and teacher branch selector now derive verified school scope. New branch ownership is persisted and immutable; projections allowlist response fields. |
| F-05 | Medium | Invalid branch field types exposed internal exception details | SEC-020 | Validated field types before service calls and sanitized branch errors. |
| F-06 | High | Mapped bearer sessions survived suspended/deleted schools or inconsistent/inactive branches | SEC-022, SEC-023, SEC-024, SEC-025 | Common authentication rechecks mapped school/branch availability on each request and before session creation. |

## All 100 practical scenarios

“Before: not baselined” means the case was not measured in the initial 40-case baseline; its final result comes from this audit run. A PASS means the tested attack was denied or its asserted invariant held, not that every related endpoint is secure.

| ID | Attempt / invariant tested | Before this fix set | Final | Evidence | Test source |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | missing bearer cannot open a protected user profile | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-002 | fabricated opaque bearer cannot authenticate | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-003 | expired access session cannot open a profile | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-004 | revoked access session cannot open a profile | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-005 | legacy account disable immediately removes access | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-006 | staff account disable immediately removes access | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-007 | login body cannot promote a Student to Super Admin | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-008 | object-shaped email cannot inject a MongoDB login selector | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-009 | object-shaped password cannot bypass verification | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-010 | oversized password is rejected before database or password work | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-011 | repeated wrong passwords are throttled for one account | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-012 | forged forwarding headers cannot bypass source throttling | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-013 | malformed JSON returns sanitized 400 rather than server failure | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-014 | oversized JSON returns bounded 413 rather than server failure | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-015 | school administrator cannot list another school branches | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-016 | foreign school branch ID is concealed like a missing branch | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-017 | forged school ownership cannot redirect branch creation | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-018 | query-string school override cannot widen branch directory | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-019 | malformed branch ID returns sanitized 400 | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-020 | invalid branch fields cannot expose internal exception details | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-021 | unmapped administrator cannot fall back to a global branch list | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-022 | school suspension invalidates existing bearer access | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-023 | deleted mapped school cannot retain authenticated access | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-024 | account and branch school mismatch cannot authenticate | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-025 | inactive mapped branch immediately removes access | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-026 | teacher-provisioning branch selector cannot reveal another school | FAIL reproduced | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-027 | suspended school cannot obtain a scoped database | PASS | PASS | Service boundary with owned replica-set fixtures | `staff-tests/security-audit-new.security.test.js` |
| SEC-028 | OR filter cannot escape the school predicate in real MongoDB | PASS | PASS | Service boundary with owned replica-set fixtures | `staff-tests/security-audit-new.security.test.js` |
| SEC-029 | cross-school insert is rejected before persistence | PASS | PASS | Service boundary with owned replica-set fixtures | `staff-tests/security-audit-new.security.test.js` |
| SEC-030 | replacement cannot change school ownership | PASS | PASS | Service boundary with owned replica-set fixtures | `staff-tests/security-audit-new.security.test.js` |
| SEC-031 | bulk operation cannot change school ownership | PASS | PASS | Service boundary with owned replica-set fixtures | `staff-tests/security-audit-new.security.test.js` |
| SEC-032 | aggregate lookup cannot escape into another school collection | PASS | PASS | Service boundary with owned replica-set fixtures | `staff-tests/security-audit-new.security.test.js` |
| SEC-033 | executable MongoDB expressions are rejected | PASS | PASS | Service boundary with owned replica-set fixtures | `staff-tests/security-audit-new.security.test.js` |
| SEC-034 | anonymous Parent data access is denied | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-035 | Teacher cannot enter school administrator dashboard | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-036 | Student cannot open Finance summary | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-037 | live classroom remains unavailable without verified integration | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-038 | legacy student directory retains bearer authentication | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-039 | obsolete administrator JWT session API remains unavailable | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-040 | anonymous paper PDF download cannot bypass authentication | PASS | PASS | Production HTTP against owned replica set | `staff-tests/security-audit-new.security.test.js` |
| SEC-041 | bearer enforcement, expiry and logout revocation | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/auth.node-test.js` |
| SEC-042 | both account disable flags reject an existing session | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/auth.node-test.js` |
| SEC-043 | login rejects disabled, malformed and unlinked accounts before issuing sessions | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/auth.node-test.js` |
| SEC-044 | partner bcrypt accounts receive hashed opaque sessions and canonical ObjectId identity | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/auth.node-test.js` |
| SEC-045 | ambiguous email and identity matches fail closed | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/auth.node-test.js` |
| SEC-046 | chat scopes authorized teacher selection to owned or verified children | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/chatRoutes.node-test.js` |
| SEC-047 | chat fails closed when trusted user branch is missing or differs from the student | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/chatRoutes.node-test.js` |
| SEC-048 | chat requires matching student, assignment and teacher branch IDs | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/chatRoutes.node-test.js` |
| SEC-049 | chat persists messages, returns history, deduplicates retries and records read receipts | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/chatRoutes.node-test.js` |
| SEC-050 | revoked parent links and teacher assignments immediately deny chat history | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/chatRoutes.node-test.js` |
| SEC-051 | chat accepts only size-bounded images and protects attachment access by conversation | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/chatRoutes.node-test.js` |
| SEC-052 | WebSocket sessions are short-lived, one-use and tied to the live access session | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/chatRoutes.node-test.js` |
| SEC-053 | integrated chat uses current partner assignments and ObjectId branch/section scope | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/chatRoutes.node-test.js` |
| SEC-054 | paper limits, exact marks, unknown scripts and template bounds are validated | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/examPapers.node-test.js` |
| SEC-055 | role, school, branch and template substitution cannot cross ownership | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/examPapers.node-test.js` |
| SEC-056 | teachers must hold an active current assignment, including when opening old drafts | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/examPapers.node-test.js` |
| SEC-057 | long papers generate multiple PDF pages with bounded template settings | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/examPapers.node-test.js` |
| SEC-058 | verified link filters bind both parent and child and exclude revocations | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/parentRoutes.node-test.js` |
| SEC-059 | listing children ignores unrelated broken Parent links without widening ownership | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/parentRoutes.node-test.js` |
| SEC-060 | another parent cannot resolve a child they are not linked to | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/parentRoutes.node-test.js` |
| SEC-061 | a broken parent reference returns an integration error and denies the child | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/parentRoutes.node-test.js` |
| SEC-062 | revoked and unverified links cannot resolve a child | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/parentRoutes.node-test.js` |
| SEC-063 | revoked status wins over a stale legacy verified flag | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/parentRoutes.node-test.js` |
| SEC-064 | child record filters cannot be redirected to another student | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/parentRoutes.node-test.js` |
| SEC-065 | non-parent roles cannot enter Parent routes | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/parentRoutes.node-test.js` |
| SEC-066 | concurrent Parents and Finance share one invoice balance reservation | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/invoiceReservations.node-test.js` |
| SEC-067 | expired and uncertain checkouts stay reserved until authoritative terminal status | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/invoiceReservations.node-test.js` |
| SEC-068 | settlement requires exact invoice, student, branch, currency and a non-overpaid balance | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/invoiceReservations.node-test.js` |
| SEC-069 | already-paid invoices are reconciliation cases, not receipt-issuing settlements | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/invoiceReservations.node-test.js` |
| SEC-070 | Finance context requires persisted Finance identity and a resolvable branch | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/financeRoutes.node-test.js` |
| SEC-071 | Finance list filters reject invalid dates, methods, and oversized student IDs | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/financeRoutes.node-test.js` |
| SEC-072 | payment history filters retain branch, status, student, dates, and method | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/financeRoutes.node-test.js` |
| SEC-073 | traceable non-cash payment methods require a transaction reference | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/financeRoutes.node-test.js` |
| SEC-074 | rejecting a partial payment releases only that pending reservation | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/financeRoutes.node-test.js` |
| SEC-075 | payment indexes protect idempotency per actor and references per branch | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/financeRoutes.node-test.js` |
| SEC-076 | student context is resolved only from the authenticated user id | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/studentRoutes.node-test.js` |
| SEC-077 | another role cannot enter Student routes | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/studentRoutes.node-test.js` |
| SEC-078 | an unlinked Student account is rejected | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/studentRoutes.node-test.js` |
| SEC-079 | owned record filters cannot be redirected to another student | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/studentRoutes.node-test.js` |
| SEC-080 | homework file validation accepts matching signatures only | Not baselined in initial 40 | PASS | Fixture/local HTTP regression with mocked persistence | `src/studentRoutes.node-test.js` |
| SEC-081 | same-branch, foreign and missing class objects are indistinguishable concealed 404s without prior list access | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/teacher-scope.security.test.ts` |
| SEC-082 | tuple integrity rejects class/subject cross-products and section mismatches | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/teacher-scope.security.test.ts` |
| SEC-083 | branch reassignment after login removes old scope; missing/inactive branch fails closed | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/teacher-scope.security.test.ts` |
| SEC-084 | section reparenting cannot preserve a stale class tuple | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/teacher-scope.security.test.ts` |
| SEC-085 | strict query/body contracts reject every attempted scope override | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/teacher-scope.security.test.ts` |
| SEC-086 | malformed IDs return sanitized 400; valid unknown assignment IDs are concealed | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/teacher-scope.security.test.ts` |
| SEC-087 | role and permission gates remain independent and current | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/teacher-scope.security.test.ts` |
| SEC-088 | a mistakenly broadened permission never bypasses the explicit role gate | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/teacher-scope.security.test.ts` |
| SEC-089 | students, teachers and Super Admins cannot use Principal-only endpoints | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/principal-authorization.security.test.ts` |
| SEC-090 | missing branch assignment fails closed on every Principal endpoint | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/principal-authorization.security.test.ts` |
| SEC-091 | foreign branch query cannot widen any read family | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/principal-authorization.security.test.ts` |
| SEC-092 | mutation body scope/actor overrides are rejected without state changes | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/principal-authorization.security.test.ts` |
| SEC-093 | foreign branch query cannot redirect valid task, safety or approval writes | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/principal-authorization.security.test.ts` |
| SEC-094 | all object IDOR lookups/mutations conceal foreign records like missing records | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/principal-authorization.security.test.ts` |
| SEC-095 | invalid object IDs fail with sanitized 400 responses | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/principal-authorization.security.test.ts` |
| SEC-096 | dashboard isolates all aggregate families and ignores a spoofed GET JSON body | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/principal-authorization.security.test.ts` |
| SEC-097 | Section from another Class is denied | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/student-admission.security.test.ts` |
| SEC-098 | inactive Period is denied | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/student-admission.security.test.ts` |
| SEC-099 | foreign Class is denied | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/student-admission.security.test.ts` |
| SEC-100 | anonymous and non-Principal admission denied | Not baselined in initial 40 | PASS | Owned replica-set HTTP/service security test | `staff-tests/student-admission.security.test.ts` |

## Exact implementation changes

- `backend/src/auth.js`: pre-query credential limits, bounded bearer format, live mapped-school/branch availability checks. Existing unmapped legacy accounts keep the old single-school contract; that is not a multi-school security guarantee.
- `backend/src/authRoutes.js` and new `loginLimiter.js`: login rate limiting. Added expiry, memory saturation and school NAT regression tests in `loginLimiter.node-test.js`.
- `backend/src/server.js`: injectable app factory for owned HTTP tests; production staff-loader scope preserved; safe parser status codes and redacted request/startup/health errors.
- `backend/src/schoolAccess.js`: deny archived/deleted schools and inactive mapped branches.
- Staff branch model/service/controller and new `utils/school-context.ts`: optional immutable school ownership for newly created branches; scoped integrated directory/detail/create and explicit projections. Existing global code uniqueness is retained; no live index migration was attempted.
- Staff `routes/admin.routes.ts`: school-scoped teacher branch selector.
- New isolated HTTP/replica-set test file, 100-case manifest, strict structured runner and reporter; `npm run test:security:100` added to backend scripts.
- Student, Parent and Finance mobile components remain JS/JSX. No mobile implementation, real environment file or provider credential was changed by this audit.

## Remaining security work — not fixed by these 100 cases

1. **High: platform-wide school isolation is still incomplete.** Legacy accounts without verified school mappings retain the old single-school contract. Other staff Mongoose services, provisioning/write paths, raw operations, historical references, socket recipient checks, files, exports and jobs still need exhaustive tenant-bound access and transactional reassignment tests. Do not treat the branch fixes as full-platform isolation.
2. **High: Ultra Admin and tenant-safe integrated administrator actions remain incomplete.** Do not enable school onboarding or wire JWT-only actions into shared opaque sessions without their tenant/session fencing contract. Integrated administrator session management remains unavailable.
3. **Deployment limitation: the login limiter is process-local.** For multiple workers/servers, use a shared store or a trusted gateway with equivalent protections, source limits, monitoring and reviewed proxy configuration. NAT thresholds need operational review. This audit did not prove distributed throttling or run a load/availability test.
4. **Unverified external workflows:** live classrooms, Parent invitation authorization, hosted payment integration/settlement, storage, AI and notifications still require their provider contracts and isolated integration tests. Live streaming and online payments remain disabled.
5. **Unverified client/device surface:** Android native PDF share/print, emulator/device role workflows, rooted-device/keychain behavior and platform permissions need separate tests. This API audit does not claim those passed.

## Safety, backups and reproduction

Only owned ephemeral MongoDB replica sets, mock persistence and loopback HTTP servers were used. The new HTTP suite explicitly prevents production startup and does not load the real `.env`. Existing fixture suites use audited test files; historical configured-database scripts are excluded. No live records, dummy live data, school mappings, production indexes, payments, provider requests, pushes, deployments or APKs were created.

Pre-change affected source is preserved in `build/local-backups/security-audit-20261026`. Source hashes are checked before applying staged changes so newer edits are not blindly overwritten. Secret files were not copied into the audit artifacts.

Run from the existing project backend:

```powershell
npm run test:security:100
npm test
npm run build
```

Full source lint from the project root: `npm run lint`. Security changes were applied to the existing project, not merely suggested.
