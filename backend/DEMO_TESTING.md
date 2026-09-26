# Isolated development demo data

The seed is fictional development data. It never runs on server/app startup and reads only `DEMO_MONGODB_URI`—never `MONGODB_URI`. Seeding and reset require `NODE_ENV=development`, `ALLOW_DEMO_SEED=true`, an explicit valid MongoDB URI/database name ending in `_demo`, and a live database connection whose actual database name matches that URI. Seed/reset operations use an expiring database lock to avoid concurrent mutation.

Do not put production credentials in `DEMO_MONGODB_URI`. Keep real values in the ignored `.env`, never in Git. The committed `.env.example` contains placeholders only. If you use Atlas, make a separate disposable database such as `school_platform_demo` and allow the current IP in Atlas. Local Mongo must be a replica set for the app's payment transactions.

## Windows PowerShell setup

From `backend`, configure a local replica-set MongoDB first. The compose file starts the service; initiate the replica set once after it is ready:

```powershell
docker compose up -d mongo
docker compose exec mongo mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
```

If the replica set is already initialized, MongoDB reports that; do not repeatedly reinitialize it. Alternatively, replace the local URI below with a private URI to a dedicated Atlas `_demo` database. Do not include a live credential in shared command history or documentation.

Set these variables in the terminal where seed/reset runs:

```powershell
$env:NODE_ENV = "development"
$env:ALLOW_DEMO_SEED = "true"
$env:DEMO_MONGODB_URI = "mongodb://127.0.0.1:27017/school_platform_demo?replicaSet=rs0&directConnection=true"
npm run seed:dev
```

The seeded database has 2 branches, 4 classes, 12 students, 15 user accounts, 84 attendance records (12×7 school days), 8 timetable periods, 4 notices, 5 assignments, 3 submissions, 2 lectures, 3 quiz attempts, 5 invoices and 3 payments. A fresh seed has 14 active accounts, 1 disabled account, 3 active teachers and 2 accounts requiring a first password change. Seed output reports actual persisted counts; normal reseed preserves changed account state, so older demo databases may differ.

On first successful seed, random passwords and account state are written to `backend/.demo-credentials.json`. It is Git-ignored. Treat it as a secret and share only with authorized testers. Passwords are never printed. Reruns reuse those passwords. No paid AI provider is called; the published lecture is explicitly labelled `TEST FIXTURE — not AI-generated` and another fictional transcript remains a draft ready for a real configured AI run.

## Accounts and role checks

Use the exact generated passwords in `.demo-credentials.json`.

| Role        | Email                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Super admin | `school-admin@example.com`                                                                                  |
| Principals  | `principal.north@example.com`, `principal.south@example.com`                                                |
| Teachers    | `teacher.math@example.com`, `teacher.science@example.com`, `teacher.south@example.com`                      |
| Accountants | `accountant.north@example.com`, `accountant.south@example.com`                                              |
| Students    | `student.ava@example.com`, `student.noah@example.com`, `student.mia@example.com`, `student.eli@example.com` |
| Parents     | `parent.lee@example.com`, `parent.park@example.com`, `parent.khan@example.com`                              |

On a new demo database, all 3 teachers are active; `parent.khan@example.com` is disabled; `accountant.south@example.com` and `parent.park@example.com` must change their initial passwords. The credential file is authoritative if those statuses have since been changed. Each student login maps to its matching student name. The Lee parent links Ava and Leo (siblings); Park links Ivy; Khan links Noah. Linked students' guardian names match those parent accounts. A successful Park first login must change the password, sign in again, then load the linked-child list before any child-scoped records.

Smoke checklist:

1. Sign in as Super Admin; check both campuses and the Users, Branches and Audit tools.
2. Sign in as each principal; north/south principals must see only their own branch's classes, students and invoices.
3. Sign in as each teacher; verify class, subject, timetable and student roster scopes. Teacher Math must not open another teacher's class. The disabled account (new DB: Khan parent) must fail login.
4. Sign in as all four students; each sees their own record only. Draft work and quiz answer keys must not be returned.
5. Sign in as each parent. Park must change the temporary password before accessing school data. Switch the selected child and confirm attendance, timetable, assignments/submissions, lesson attempts, notices and fees switch to only that child. A linked-child ID belonging to another parent must be rejected.
6. Check the South accountant's and Park parent's forced password-change screens and the two accountants' separate invoice scopes. Verify unpaid, partial, fully-paid, overdue and future examples and the CASH/BANK/CHEQUE receipts.
7. Unauthenticated API requests should return 401; role-inappropriate requests should return 403. Revoked/expired API sessions clear mobile credentials and return to Login.
8. For teacher AI workflow, configure `LLM_API_KEY` and `LLM_MODEL` only in a private development environment. Without them, Generate/AI-review actions show the server's explicit configuration error. Review suggested marks and submit a separate final teacher grade.

## Running API and Android phone against the same demo DB

In a backend terminal, set the same demo variables and explicitly point the development API at that database (this process environment takes precedence over `.env`):

```powershell
$env:NODE_ENV = "development"
$env:DEMO_MONGODB_URI = "mongodb://127.0.0.1:27017/school_platform_demo?replicaSet=rs0&directConnection=true"
$env:MONGODB_URI = $env:DEMO_MONGODB_URI
npm run dev
```

Do not copy a production `MONGODB_URI` into the demo variable. On the phone-connected computer, run these in separate terminals from the project root:

```powershell
adb reverse tcp:4000 tcp:4000
yarn start
```

Then install/start the Android app on the connected phone:

```powershell
yarn android
```

The app's development API URL is `http://localhost:4000`; `adb reverse` forwards the phone's localhost port to the computer's backend. USB debugging/ADB authorization must be enabled. On the Android emulator (without a physical phone), use `http://10.0.2.2:4000` instead and update `src/config.js` for that local test.

## Reseed and safe reset

Rerunning `npm run seed:dev` upserts the same manifest-owned IDs, preserves the first recorded date anchor and generated passwords, and refreshes fixture-owned academic/attendance/finance records. Existing user documents are not overwritten during ordinary reseeding: password hash, role, active state, must-change flag, token version and access scopes are preserved. A narrowly matched migration repairs the known old Mia/Eli student links only when their stored mappings are still exactly the old fixture values. Manually customized mappings remain unchanged. If you manually edit a seeded non-user record, a later seed refreshes that record back to fixture values.

Reset must only be run against a disposable `_demo` DB. Stop the API and other demo-data writers first; the reset's reference scan and deletes are not one cross-process transaction. In a backend terminal:

```powershell
$env:NODE_ENV = "development"
$env:ALLOW_DEMO_SEED = "true"
$env:DEMO_MONGODB_URI = "mongodb://127.0.0.1:27017/school_platform_demo?replicaSet=rs0&directConnection=true"
npm run seed:dev:reset
```

Reset deletes exact manifest-owned IDs in dependency order and never drops a database. It checks known schema references, audit references, and scans other MongoDB collections recursively for seed ObjectIds or exact 24-character hex-string references. Any detected outside reference stops deletion; unrelated unlinked records remain. The scan is deliberately conservative and can flag coincidental matching IDs. It cannot discover references stored in external systems or references encoded in non-ID formats, and concurrent writes during the scan are why the API must be stopped. If a reset is interrupted, its manifest remains for a retry. The generated credentials file is retained so a later reseed keeps the same passwords.

Unset the opt-in when finished: `Remove-Item Env:ALLOW_DEMO_SEED`. Never run seed/reset against production or a database with valuable records.
