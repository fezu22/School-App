# Validation record - School Platform

Run on 2026-09-26 for `fix/native-school-demo-workflows` after fixing the Windows test harness and the parent first-login regressions.

## Passed

- Backend integration: 18 tests passed, 0 failed. MongoDB 7.0.14 ran in disposable in-memory replica sets; tests did not connect to `backend/.env` or a real-school database.
- React Native tests: 11 tests passed across 4 suites.
- ESLint: 0 errors; 18 inline-style warnings remain.
- Backend JavaScript syntax checks and `npm run check`: passed.
- Android production JavaScript bundle: Metro completed and wrote the release bundle and assets.

The backend coverage includes seed idempotency and stable mappings; changed password, disabled-account, must-change-password and token-version preservation; credential-file status synchronization; unsafe seed/reset rejection; reset refusal for manual references; role and branch isolation; parent child scope and first-password-change flow; draft and quiz answer-key protection; eligible quiz scoring; invoice totals and payment methods; and the existing attendance, submission, grading, timetable and payment workflows.

## Android native build status

The Android SDK and an ADB-connected TECNO device are available. The release APK build was attempted with one Gradle worker but failed in Gradle's transform cache while moving temporary workspaces to immutable locations (`Could not move temporary workspace ... to immutable location`). No APK was installed from that failed build, and the phone UI was not physically inspected. This is distinct from the successful Metro JavaScript bundle check.

## Not tested

- No live-school or Atlas database was seeded or modified.
- No paid AI provider request was made.
- Email, GPS tracking, audio transcription, live streaming, paper/photo scanning and payment-gateway flows remain unimplemented.
- iOS was not built.
