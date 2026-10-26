> Deep testing update (2026-10-26): see [DEEP_TEST_REPORT.md](DEEP_TEST_REPORT.md) for reproduced defects, fixes and current measured results. Platform-wide isolation, Ultra Admin, provider and native device work remain unfinished.

> Local merge update (2026-10-25): see [LOCAL_INTEGRATION_REPORT.md](LOCAL_INTEGRATION_REPORT.md) for current measured results, preserved files and unfinished work. The original checkpoint below is historical. Platform-wide isolation and Ultra Admin are still unfinished. Streaming and online payments remain disabled.

# School Management integration — development checkpoint

This is not a complete or production-ready SaaS release. Originals were preserved; no live MongoDB, payment gateway, AI provider or ZEGO service was contacted.

## Implemented and checked
- Integrated JS/TypeScript backend routing under one optional startup.
- Common opaque bearer authentication for both scrypt and bcrypt accounts, disabled-account checks, ambiguous-identity denial, canonical staff ObjectId mapping, logout/expiry.
- Native Teacher/Principal/Super Admin navigators connected to the common login and API root; existing Student/Parent/Finance retained.
- Integrated chat uses partner teacherassignments with class/section, branch, active-state and validity checks; legacy mode retains legacy assignment reads.
- Exam-paper native screen: school template creation, authorized academic options, numbered questions/marks, saved drafts, preview and authenticated PDF export/share.
- School/branch/assignment restrictions on the NEW paper routes; revoked teachers cannot open/export old drafts. These new-route protections do NOT establish platform-wide tenancy.
- Multi-page A4/Letter PDFs with school heading, configurable text header/footer, margins and page numbers. Template snapshot is saved with each paper.

## Verification
- Backend: 88 fixture/unit tests passed.
- Mobile: 9 suites, 60 tests passed.
- Frontend TypeScript and backend TypeScript build passed.
- Android production JavaScript bundle passed.
- Scoped UI lint: zero errors, four inline-style warnings.
- PDF rendered and visually inspected.
- Native Android device, native PDF share/print and APK build NOT tested. react-native-share was added, so rebuild native dependencies on the development machine.
- Isolated live-lesson MongoDB tests were blocked because mongod exited with open: Operation not permitted.

## Important feature limits
- Paper routes need a REAL verified users.schoolId referencing schools._id and branches.schoolId referencing that same school. No account or branch mappings were guessed or written. Missing mappings return a configuration error.
- Exam templates currently support Latin text and text headers/footers, not logos, Urdu fonts, question banks or review/publication workflow. Draft export is not exam publication.
- Integrated live lessons remain DISABLED pending transactional verification of shared session fencing and its background enforcement. Parent invitations/viewer authorization are still missing.
- Ultra Admin and platform-wide tenant isolation are NOT implemented. Do not deploy this checkpoint for multiple schools.
- Full Stitch/prototype visual redesign, AI lesson generation and real card checkout are NOT completed.

## Run locally
1. Extract into a separate directory; keep your current project unchanged.
2. At root: npm ci.
3. In backend: npm ci. Configure backend/.env privately using a test database first. Credentials are excluded.
4. In backend: npm run start:integrated. Legacy npm start remains JS-only. Starting the server uses configured database/index initialization; it was not started against live data here.
5. At root: npm start; run your native development build on Windows/macOS as appropriate.
6. Sign in with an existing real account. Staff has an Exam papers & print templates entry above its navigator. School mapping and academic records must exist for actual paper operations.
7. Backend tests: npm test inside backend. Mobile tests: npm test -- --runInBand at root.

See AI_STUDIO_REMAINING.md for unfinished development and external configuration requirements.
