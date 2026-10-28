# Greenwood School Management System — Engineering Audit, Implementation & Verification Report

## 1. Executive Summary & Actual Baseline

This repository contains the complete **Greenwood School Management System** merged directly onto the full `School-App-main` project tree (native React Native mobile application in `index.js`, `src/mobileApp/**`, `src/staff/**`, `android/`, and `ios/`, plus the unified Express + TypeScript backend in `backend/src/**` and `backend/src/staff/**`).

### Two Android Applications Resolution
- **Primary Mobile Application**: Native React Native application (`index.js` -> `App.tsx` -> `src/mobileApp/SessionBootstrap.jsx` & `src/mobileApp/app/MobileApp.jsx`, with Android Gradle project under `android/`).
- **Legacy Compose Prototype Archived**: The earlier standalone Kotlin Jetpack Compose demo that used local in-memory sample state in `app/src/main/java/com/example/MainActivity.kt` has been archived to `archive/compose-demo/MainActivity.kt`, and the duplicate `app/src/main/assets/index.android.bundle` was removed so only `android/app/src/main/assets/index.android.bundle` holds the React Native bundle. The root `app/` module is retained solely as a minimal non-demo host stub required by the AI Studio build container.

---

## 2. Optional Configuration & Secret Isolation Verification

### Optional Feature Gates (No Dummy Secrets Required at Startup)
The basic application starts with only `MONGODB_URI` and `MONGODB_DB` configured. Optional features fail closed with explicit `503` / disabled responses when their secrets or verification flags are absent:

| Feature | Environment Variables | Behavior When Absent |
| --- | --- | --- |
| **Legacy Super Admin Bootstrap** | `SUPER_ADMIN_BOOTSTRAP_SECRET` (>= 32 chars, `X-Bootstrap-Secret` header) | Returns `503 Super Admin bootstrap is disabled`. Rejects placeholder/dummy values (`UNCONFIGURED_*`, `PLACEHOLDER_*`, `DUMMY_*`). |
| **Ultra Admin Platform Bootstrap** | `PLATFORM_ULTRA_ADMIN_BOOTSTRAP_SECRET` (>= 32 chars, `X-Platform-Bootstrap-Secret` header) | Returns `503 Ultra Admin platform bootstrap is disabled`. |
| **Standalone Staff JWT Auth** | `JWT_SECRET` | Only required when standalone staff JWT mode is used (`INTEGRATED_STAFF_ENABLED !== 'true'`). Integrated mode uses opaque 256-bit SHA-256 hashed tokens in `refreshTokens` and a process-scoped 256-bit random HMAC fallback for admission operation fingerprints. |
| **Online Payment Gateway (Easypaisa & Per-School Hosted Card)** | `ONLINE_PAYMENTS_VERIFIED=true`, `CARD_PROVIDER_WEBHOOK_SECRET` (>= 32 chars), per-school merchant URLs/keys | `GET /api/parents/me/fees/checkout/config` returns `{ enabled: false, methods: [] }`; checkout and status reconciliation endpoints return `503`. |
| **ZEGO Cloud Live Classes** | `LIVE_LESSON_ENABLED=true` (alias `LIVE_LESSONS_VERIFIED=true`), `ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED=true` (alias `ZEGO_ROOM_PRIVILEGES_ENABLED=true`), `ZEGOCLOUD_APP_ID` (alias `ZEGO_APP_ID`), `ZEGOCLOUD_SERVER_SECRET` (alias `ZEGO_SERVER_SECRET`), `LIVE_LESSON_TOKEN_TTL_SECONDS` (alias `ZEGO_TOKEN_TTL_SECONDS`) | `/api/live-lessons/*` returns `503 Live lessons are disabled pending ZEGO provider configuration and verification`. Conflicting values between canonical `ZEGOCLOUD_*` and legacy `ZEGO_*` aliases fail closed (`503`). |
| **Recorded Lessons Gemini AI Drafts** | `RECORDED_LESSONS_AI_ENABLED=true`, `GEMINI_API_KEY` | `POST /api/recorded-lessons/:id/process-ai` returns `503` (`code: 'AI_CONFIGURATION_REQUIRED'`), records `jobStatus: 'ai_configuration_required'`, and never fabricates AI output. Manual Teacher summary/notes/quiz review and publication remain available. |

### Client & Bundle Secret Verification
- `app/build.gradle.kts` `secrets` plugin is configured with `ignoreList.add(".*")` and does not read `.env`, ensuring `BuildConfig.java` contains zero backend secrets.
- Verified that `MONGODB_URI`, `JWT_SECRET`, `SUPER_ADMIN_BOOTSTRAP_SECRET`, `PLATFORM_ULTRA_ADMIN_BOOTSTRAP_SECRET`, `CARD_PROVIDER_WEBHOOK_SECRET`, `EASYPAISA_API_KEY`, `ZEGOCLOUD_SERVER_SECRET`, `ZEGO_SERVER_SECRET`, and `GEMINI_API_KEY` are never referenced in `src/mobileApp/**`, `src/staff/**`, or embedded in `android/app/src/main/assets/index.android.bundle`.

---

## 3. Completed Engineering Work by Module

### A. DLP Authorization & Concurrency Fencing (`backend/src/dlpRoutes.js`, `src/mobileApp/TeachersDlpPage.jsx`)
- **Persisted Active User Requirement**: Every request to `/api/dlp` resolves the persisted staff user from `users` (`active !== false`, `isActive !== false`, `status !== 'suspended'`, matching `role`). Unpersisted or inactive accounts are rejected with `403`.
- **Strict Teacher Assignment Enforcement**:
  - A Teacher with **zero** assignments in `teacherassignments` / `teacherAssignments` is strictly denied (`403 Teacher has no assignments and cannot access or modify DLP records`) on both read (`GET /api/dlp`) and write (`POST /api/dlp`).
  - Requires a current, active, non-revoked assignment (`isActive !== false`, `active !== false`, `status !== 'revoked'`, `revokedAt == null`) within valid date boundaries (`validFrom <= now` and `validUntil >= now`).
  - Matches `schoolId`, `branchId`, `classId`, and `section` (`sectionId` / `section`).
  - Never defaults missing `section` values to `'A'` (both backend `dlpRoutes.js` and frontend `TeachersDlpPage.jsx` require an explicit section).
  - Verifies `classId` and `section` against `schoolclasses` / `sections` catalog when populated.
- **Read/Edit/Share/Version Rechecks & Fencing**:
  - Rechecks teacher assignment on `GET /api/dlp`, `GET /api/dlp/:dlpId`, `GET /api/dlp/:dlpId/versions/:versionId`, `POST /api/dlp`, `PATCH /api/dlp/:dlpId`, `POST /api/dlp/:dlpId/send-principal`, and `POST /api/dlp/:dlpId/send-parents`.
  - Uses `executeFencedDlpMutation` to re-verify the active user and assignment before finalizing writes and rolls back `dlpRecords`, `dlpVersions`, `notifications`, and `parentNotifications` if an assignment is revoked or reassigned concurrently.
- **Audience Separation & Parent Notification Linkage**:
  - `POST /api/dlp/:dlpId/send-principal` creates `dlpVersions` with `audience: 'principal'`, `status: 'submitted'`, including `internalStaffNotes`.
  - `POST /api/dlp/:dlpId/send-parents` creates `dlpVersions` with `audience: 'parent'`, `status: 'published'`, strictly excluding `internalStaffNotes`, and inserts deduplicated `parentNotifications` (`type: 'parent_dlp_shared'`) with the exact `dlpVersionId` for verified parents of students in that `branchId`, `classId`, and `section`.
  - `GET /api/parents/me/notifications/:notificationId` in `backend/src/parentRoutes.js` verifies child class and section membership, resolves the exact published parent `dlpVersionId`, and strips `internalStaffNotes`.

### B. Platform-Wide Fail-Closed Tenant Isolation (`backend/src/schoolDatabase.js`, `backend/src/schoolAccess.js`, `backend/src/auth.js`, `backend/src/studentRoutes.js`, `backend/src/parentRoutes.js`, `backend/src/routes.js`, `backend/src/chatService.js`)
- **Fail-Closed SaaS Mode**:
  - Missing `schoolId` on users, branches, students, or target records fails closed (`503` / `403` / `404`) across `auth.js`, `schoolAccess.js`, `identityReferenceAdapter.js`, `studentRoutes.js`, `parentRoutes.js`, `financeRoutes`, `routes.js`, and `chatService.js`.
  - Legacy single-school operation is isolated behind explicit `LEGACY_SINGLE_SCHOOL_MODE=true` and rejects SaaS `schoolId`-mapped records when enabled so legacy and SaaS records cannot mix.
- `createSchoolDatabase(db, verifiedSchoolId)` enforces immutable `schoolId` predicates on `find`, `findOne`, `countDocuments`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `aggregate`, and `bulkWrite`, blocking `$where`, `$function`, `$accumulator`, `$lookup`, `$unionWith`, `$out`, and `$merge`.
- `verifiedSchoolDatabase(db, actor)` verifies the school is active and non-suspended, and blocks `ultra_admin` from school-scoped student/parent/academic records (`403`).

### C. Ultra Admin & Atomic School Onboarding (`backend/src/ultraAdminRoutes.js`, `src/mobileApp/UltraAdminScreen.jsx`)
- Controlled first Ultra Admin bootstrap (`POST /api/ultra-admin/bootstrap`) gated by `X-Platform-Bootstrap-Secret` header and `PLATFORM_ULTRA_ADMIN_BOOTSTRAP_SECRET` (>= 32 chars).
- Supports `GET /api/ultra-admin/overview`, `GET /api/ultra-admin/schools`, `GET /api/ultra-admin/schools/:schoolId`, `POST /api/ultra-admin/schools`, `PATCH /api/ultra-admin/schools/:schoolId/status`, `PATCH /api/ultra-admin/schools/:schoolId/subscription`, and `GET /api/ultra-admin/audit-logs`.
- **Truly Atomic Onboarding & Duplicate/Retry Protection**:
  - Creates unique database indexes (`unique_school_code`, `unique_school_onboarding_idempotency`, `unique_branch_code_per_school`, `unique_user_email_lower`) via `ensureOnboardingIndexes`.
  - `POST /api/ultra-admin/schools` runs inside `runAtomicOnboarding` using a MongoDB client transaction session (`(db.client || getClient()).startSession()` + `session.withTransaction(...)`) with compensating rollback if the test double does not expose sessions, binds `branchId: branchDoc.id` on the initial School Super Admin, and maps MongoDB `11000` duplicate-key errors to HTTP `409`.
  - Enforces in-flight concurrency locks on school code, initial Super Admin email, and `Idempotency-Key` / `idempotencyKey`, plus idempotent replay when retried with identical parameters (`200`, `idempotentReplay: true`) and `409` on conflicting parameters.
- **School Suspension & Billing Honesty**:
  - Suspending a school immediately revokes active `refreshTokens` for all users in that school; `auth.js` and `schoolAccess.js` block login and API/WebSocket access for suspended schools.
  - Rejects manual attempts to set `billingProviderVerified: true` or `billingSettlementRef` (`403`), keeping manual subscription updates marked `subscriptionVerification: 'recorded_only'`.

### D. Academic Role Flows & Applications Routing (`backend/src/applicationReviewRoutes.js`, `src/mobileApp/TeacherApplicationsPage.jsx`)
- **Applications Routing**:
  - Student/Parent -> Assigned Class Teacher (`POST /api/students/me/applications`, `POST /api/parents/me/children/:studentId/applications`, `GET /api/applications`, `POST /api/applications/:applicationId/review`).
  - Teacher -> Principal (`GET /api/applications/principal`, `POST /api/applications/principal`, `POST /api/applications/principal/:applicationId/review`) with branch/school isolation and Teacher recipient notifications.
  - Principal -> Super Admin (`GET /api/applications/super-admin`, `POST /api/applications/super-admin`, `POST /api/applications/super-admin/:applicationId/review`) with school isolation, status history, and Principal recipient notifications.

### E. Recorded Lessons, Quizzes & Server-Side Gemini AI (`backend/src/recordedLessonRoutes.js`, `backend/src/learnerFeatureRoutes.js`, `src/mobileApp/RecordedLessonsPage.jsx`)
- **Complete Lifecycle**:
  - Teacher upload/link with `branchId`, `classId`, `section`, `subject`, `chapter`, and `topic` metadata.
  - Optional server-side Gemini AI draft summary, revision notes, and quiz generation (`POST /api/recorded-lessons/:lessonId/process-ai`) fenced by `sourceVersion`.
  - Mandatory human review/approval (`POST /api/recorded-lessons/:lessonId/review`) before publication (`POST /api/recorded-lessons/:lessonId/publish`); AI output is never auto-published.
  - Student playback (`GET /api/recorded-lessons/:lessonId/media`), progress tracking (`POST /api/recorded-lessons/:lessonId/progress`), and quiz attempts (`POST /api/recorded-lessons/:lessonId/quiz-attempts` and `POST /api/quizzes/:quizId/attempts`) with `correctOption` hidden from learner payloads and scored server-side.
  - Teacher/Principal/Super Admin and Verified Parent visibility of lesson progress and quiz results via `GET /api/recorded-lessons/:lessonId/results`.

### F. Unified ZEGO Live Classes Configuration (`backend/src/zegoConfig.js`, `backend/src/server.js`, `backend/src/staff/src/app.ts`, `backend/src/staff/src/services/rtc/zego-rtc-provider.ts`, `backend/src/staff/src/services/rtc/zego-room-control.ts`)
- Unified ZEGO configuration validation in `backend/src/zegoConfig.js` (`.d.ts` typed for TypeScript staff modules):
  - Supports canonical `LIVE_LESSON_ENABLED`, `ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED`, `ZEGOCLOUD_APP_ID`, `ZEGOCLOUD_SERVER_SECRET`, and `LIVE_LESSON_TOKEN_TTL_SECONDS` alongside legacy aliases (`LIVE_LESSONS_VERIFIED`, `ZEGO_ROOM_PRIVILEGES_ENABLED`, `ZEGO_APP_ID`, `ZEGO_SERVER_SECRET`, `ZEGO_TOKEN_TTL_SECONDS`).
  - Explicitly rejects conflicting values between canonical and alias variables.
  - Keeps `serverSecret` non-enumerable on configuration objects and out of logs, responses, and client bundles.

### G. Finance & Connected Per-School Hosted Card Checkout + Webhooks (`backend/src/parentPaymentRoutes.js`, `backend/src/parentPaymentReconciler.js`, `backend/src/server.js`, `backend/src/routes.js`)
- Connected `cardProviderConfiguration()` / `resolveSchoolCardConfig()` and `verifyCardWebhookSignature()` directly to checkout (`POST /api/parents/me/children/:studentId/fees/checkout`), status reconciliation (`POST /api/parents/me/children/:studentId/fees/checkout/:paymentId/reconcile`), and background reconciliation (`parentPaymentReconciler.js`).
- Mounted raw-body HMAC-SHA256 verified card webhook endpoints (`POST /api/payments/webhooks/card`, `POST /api/parent/payments/webhooks/card`, `POST /api/parents/me/payments/webhooks/card`) verifying event, per-school `merchantId`, `orderRef`, `amount`, `currency`, `schoolId`, `branchId`, and `invoiceId` ownership before settling or releasing invoice reservations.
- Rejects raw PAN/CVV (`assertNoRawCardData`) and client redirect settlement parameters (`assertNoClientSettlementParams`).

### H. Exams & Embedded Urdu/RTL Multi-Page PDF Printing (`backend/src/examPapers.js`, `src/mobileApp/features/exams/ExamPapersPage.jsx`)
- Reusable school print templates (`A4`/`LETTER`, margins, header/footer, signature labels, and validated base64 PNG/JPEG school logos) with SSRF protection rejecting external `logoUrl` / `imageUrl` fields (`400`).
- Deterministic Urdu/Arabic contextual glyph shaping (`shapeUrduTextForPdf`) into Arabic Presentation Forms (`\uFB50-\uFDFF`, `\uFE70-\uFEFF`) with visual RTL word ordering and embedded `NotoNaskhArabic` (`UrduEmbedded`) font usage across headers, titles, instructions, questions, MCQ options, signature blocks, and footers.
- Reusable Question Bank endpoints (`GET /api/exam-papers/question-bank`, `POST /api/exam-papers/question-bank`) and `draft` -> `in_review` -> `approved` -> `published` workflow.

---

## 4. Verification Results

All automated checks were executed against the working tree and verified passing:

1. **Relative Import & Asset Resolution Check**:
   - Command: `node scripts/validate-mobile-imports.js`
   - Result: **PASS** (`All relative mobile imports and assets resolve.`)
2. **Backend Node Test Suite**:
   - Command: `npm --prefix backend test`
   - Result: **PASS** (**124 / 124 tests passing**, 0 failures — covering `auth`, `applicationService`, `chatRoutes`, `directoryAccess`, `dlpRoutes`, `examPapers`, `financePayrollRoutes`, `financeRoutes`, `financeWorkspaceRoutes`, `identityReferenceAdapter`, `invoiceReservations`, `learnerFeatureRoutes`, `loginLimiter`, `parentPaymentReconciler`, `parentPaymentRoutes`, `parentRoutes`, `recordedLessonRoutes`, `schoolAccess`, `schoolDashboard`, `schoolDatabase`, `serverRouting`, `staffIntegration`, `studentRoutes`, `ultraAdminRoutes`, `userNotificationRoutes`).
3. **Staff TypeScript Security & ZEGO Control Tests**:
   - Command: `npm --prefix backend run test:staff:isolated zego-room-control.test.ts`
   - Result: **PASS** (**3 / 3 tests passing**, 0 failures).
4. **Mobile Jest Test Suite**:
   - Command: `npm test -- --watchAll=false`
   - Result: **PASS** (**10 / 10 test suites passing, 64 / 64 tests passing**).
5. **TypeScript Type Checks & ESLint**:
   - Command: `npm --prefix backend run build` & `npm run lint`
   - Result: **PASS** (0 errors).
6. **Android Applet Compilation**:
   - Tool: `compile_applet`
   - Result: **PASS** (`Build succeeded - the applet is compiled`).

---

## 5. Exact Windows (PowerShell / CMD) Install, Run & Test Commands

```powershell
# 1. Install root (React Native mobile) and backend dependencies
npm install
npm --prefix backend install

# 2. Configure backend environment
copy backend\.env.example backend\.env
# Edit backend\.env to set MONGODB_URI and MONGODB_DB to your local/isolated MongoDB instance.
# Optional secrets (SUPER_ADMIN_BOOTSTRAP_SECRET, PLATFORM_ULTRA_ADMIN_BOOTSTRAP_SECRET,
# CARD_PROVIDER_WEBHOOK_SECRET, ZEGO_APP_ID, ZEGO_SERVER_SECRET, GEMINI_API_KEY) can remain commented out.

# 3. Run the unified backend API server (JS Student/Parent/Finance + TS Staff/Admin/Principal/Teacher)
npm --prefix backend run start:integrated

# 4. Run the React Native Metro bundler (in a second terminal)
npm start

# 5. Launch the native React Native Android app on an emulator or connected device (in a third terminal)
npx react-native run-android

# 6. Run all verification checks and tests on Windows
node scripts/validate-mobile-imports.js
npm --prefix backend test
npm --prefix backend run build -- --noEmit
npx tsc --noEmit
npm test -- --watchAll=false
```
