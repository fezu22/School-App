# Validation record — release 0.2

Executed in the development environment:

- 12 backend integration tests PASS, using a disposable real MongoDB 7 replica set.
- Tested empty school DB, branch/class/student creation, admin-only accounts, teacher/guardian/branch isolation, attendance roster validation, assignment draft/publish/submit/grade, partial payments, idempotent retry, concurrent overpayment prevention, timetable overlap, unavailable AI configuration, quiz answer-key privacy and scoring, account disabling, and scope-change session revocation.
- 3 React Native component tests PASS: teacher navigation, parent navigation, and login/error behavior.
- Android production JavaScript bundle generated successfully by Metro.
- JSX lint errors: none after cleanup.
- Android manifest duplicate cleartext attribute fixed; compatible react-native-screens pinned to 4.19.0 for RN 0.81.

Not executed:

- Android Gradle APK compilation and actual phone/emulator UI testing (Android SDK not available here).
- iOS build.
- Live LLM requests with school credentials/content. Provider response correctness and marking quality must be evaluated on approved school samples before relying on grades.
- Email, streaming, audio transcription, paper scans, GPS or payment gateway: these modules are not implemented in this release.

Test fixtures exist only under tests and are written to a temporary test database, not the school's configured database. Production startup inserts only the administrator configured by the operator.
