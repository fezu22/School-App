> Security audit update (2026-10-26): [SECURITY_AUDIT_100.md](SECURITY_AUDIT_100.md) records 100/100 selected cases passed, 16 reproduced failures fixed in 6 groups, and 106 backend regressions passed. Integrated branch operations/selector and mapped-school session checks now have additional protections. Platform-wide school isolation and Ultra Admin remain incomplete; the checkpoint below is historical.

# Local integration report — 2026-10-25

**Status: merged development checkpoint; the full remaining-development request is not complete.** Platform-wide school isolation and Ultra Admin remain unfinished. Do not deploy this checkpoint as a multi-school release.

## Source, comparison and preservation

The supplied workspace contains the extracted `SchoolManagementSystem` update. `INTEGRATION_STATUS.md` and `AI_STUDIO_REMAINING.md` were read before merging into `D:\work\Apps\SchoolManagementSystem`.

The destination Git working tree was clean at the initial inspection. After normalizing only line endings, comparison found 237 matching files, 14 substantive existing-file differences and 345 source-only files. The reviewed merge applied 358 files, omitting environment files and an irrelevant temporary image. Matching files and destination-only files were preserved. No native Android/iOS project files needed substantive replacement.

Comparison manifests, reviewed text differences and original affected files are under `D:\work\Web App\SchoolManagement_Exams_Chat_Update`:

- `merge-manifest.json`, `merge-selected.json`, `merge-review.diff`
- `merge-backup-original` — affected existing files before integration
- `post-merge-backup` — pre-fix versions preserved for subsequent changes

The real backend environment file and `database.js` were not changed. Existing Student, Parent and Finance components remain JS/JSX. Their existing implementations, unrelated files and native configuration were preserved. No live database server was started, no live records or school mappings were modified, and no dummy records were inserted into the real database. Test fixture records were confined to mocks or owned ephemeral databases. No push, deployment or APK generation was performed.

## Implemented

- Integrated backend entry point and segment-aware staff route dispatch, preserving learner and Finance APIs.
- Shared opaque bearer sessions for legacy scrypt and partner bcrypt accounts, canonical staff identity mapping, account-disable checks and session expiry/revocation.
- Teacher, Principal and school Super Admin navigation through common authentication and the common API root.
- Partner assignment-based chat authorization, including section, branch, validity, active-state and revocation checks.
- Exam-paper catalog, templates, draft creation/listing/preview and authenticated PDF export/share; existing school/branch/assignment checks retained.
- Corrected integrated routing for student enrollment and attendance review. Staff enrollment/profile clients use `/api/staff-students`, preserving both legacy `/api/students` directory contracts and `/api/students/me`. The standalone partner `/api/students` contract is retained as an alias.
- Routed staff usage, backup and health APIs. Integrated usage totals are school-scoped. Integrated administrator session management explicitly returns 503 until it can safely list/revoke the shared opaque sessions; it does not operate on the obsolete partner JWT session store.
- Added an explicit `ONLINE_PAYMENTS_VERIFIED=true` requirement in addition to merchant configuration. All online payment routes except public configuration now stop before database access when disabled, including status endpoints that can reconcile/settle. The reconciliation worker also remains disabled through the same configuration gate. No verification flag was set.
- Integrated live lessons remain blocked. Standalone staff live endpoints and maintenance now also default to disabled through `LIVE_LESSONS_VERIFIED`; no verification flag was set.
- Added a reusable immutable school-scoped native database boundary, verified account/school/branch resolution and adversarial tests. Adopted it for integrated Super Admin branch counts/lists and usage totals. Platform identities do not obtain school-data authority through that boundary.
- Added safe isolated staff-test execution (`npm run test:staff:isolated`). It excludes historical `auth.test.ts` and `userModel.test.ts`, which load dotenv and write to the configured database. The runner replaces live connection environment settings with a non-working loopback sentinel.
- Added HTTP route/import smoke tests, payment-disable regression tests, dashboard cross-school regression tests and a source-only school-isolation inventory script.
- Corrected the historical communications test's moved mobile-service import and supplied its native API configuration boundary in Node while retaining the real adapter/local HTTP round trip. Added the required managed curriculum only to the Teacher Home test that opens a new attendance session; production curriculum authorization was not weakened.
- Fixed unused catches and excluded generated `build`/`backend/dist` artifacts from source lint.

## Verification on this machine

| Check | Result |
| --- | --- |
| Mobile dependency installation | `npm ci --no-audit --no-fund`: passed, 921 packages |
| Backend dependency installation | `npm ci --no-audit --no-fund`: passed, 186 packages; MongoDB postinstall download disabled |
| Backend fixture/HTTP/school-dashboard suite | 103 passed, zero failures |
| Mobile Jest | 9 suites / 60 tests passed |
| Mobile TypeScript | `tsc --noEmit`: passed |
| Backend TypeScript | `npm run build`: passed |
| Full source lint | zero errors, 48 warnings |
| Android production JavaScript bundle | passed; `build/integration-android/index.android.bundle`, 65 assets; no APK |
| Isolated standalone live-lesson replica-set suite | 77 passed, zero failures |
| Other isolated staff security suites, original full run | 1,076 passed / 1,078 entries; two failures before fixture fixes |
| Both affected isolated staff suites after fixes | 89 passed, zero failures; targeted rerun, not a second full run |
| Real provider / native device tests | not run |

The initial concurrent mobile run had one cold-transform 5-second timeout. An unchanged rerun passed all 60 tests, as did the final-source rerun. A new school-mapping fixture initially lacked the adapter's `findOne` method; the fixture was corrected and the backend suite passed. The full isolated staff run exposed a stale frontend import and a legacy Class fixture attempting a new attendance write without the now-required managed curriculum. Both affected suites passed their 89-test recheck after the fixture corrections. The unchanged passing suites were not repeated. These failures were not suppressed.

The HTTP smoke tests import application objects and open local ephemeral HTTP ports; they never call backend startup/database/index initialization. They verify protected route mounting, module resolution, learner route preservation and disabled streaming/payment responses. Staff clients use `src/staff/services/api/apiClient.ts` with `fetch`, the shared API root and bearer tokens; exams use shared `authRequest`. Production still requires a configured HTTPS API origin. No successful real-account/device workflow is claimed.

Logs and generated artifacts are under the destination `build` folder: `backend-fixture-tests.log`, `mobile-tests.log`, `staff-security-tests.log`, `staff-security-recheck.log`, `integration-eslint.json`, `school-isolation-inventory.json` and `integration-android`.

## Remaining development

See `SCHOOL_ISOLATION_AUDIT.md` for concrete adoption gaps. The new wrapper is **not** automatically applied to all legacy `getDatabase()` calls or Mongoose model queries. Realtime, files, background jobs, historical records, cross-reference ownership and exports still need a platform-wide verified tenant context and adversarial HTTP/replica-set coverage. One scoped dashboard and the exam module do not prove multi-school safety.

Ultra Admin bootstrap, school provisioning, school Super Admin invitations, suspension, plans, limits and audit remain unimplemented. They must follow complete tenant isolation; existing school Super Admin is not Ultra Admin.

The rest of `AI_STUDIO_REMAINING.md` also remains open: tenant-safe shared-session administrator listing/revocation; integrated shared-session live-class transaction/background enforcement verification; Parent live recipient authorization; legacy/staff academic ID compatibility; full role-screen designs; exam logos, Urdu/fonts, question banks and approval/publication/versioning; real hosted gateway and multi-invoice settlement; recorded storage/jobs and Teacher-reviewed AI; Finance/PTM/calendar/transport end-to-end verification; Android native workflows and PDF share/print.

## External setup requirements

- Owner-approved real school/branch/class/user mappings and authorized development accounts; no mappings were guessed or migrated.
- A separate development MongoDB replica set for actual application workflows. Ephemeral replica-set tests work on this Windows machine; the earlier checkpoint's mongod limitation no longer applies here.
- ZEGO credentials/permissions and verified provider classroom/background enforcement tests; integrated shared-session verification and Parent authorization are still needed before streaming enablement.
- Official selected payment-provider integration contract, merchant sandbox credentials, school settlement policy and end-to-end verification before setting any payment verification flag.
- AI, object storage, email/push and other provider accounts/keys as the corresponding unfinished features require.
- The original UI design archives for faithful implementation of the remaining role redesign; these are not implemented by this update.
- A configured HTTPS production API origin when eventually preparing a release, plus a native development rebuild for newly installed native packages and device verification of PDF share/print. No release or APK was produced.
