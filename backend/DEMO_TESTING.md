# Isolated demo data

The demo seed is fictional development data. It is never loaded automatically at server startup and it never reads `MONGODB_URI`. Seed and reset require all of these safeguards:

- `NODE_ENV=development`
- `ALLOW_DEMO_SEED=true`
- `DEMO_MONGODB_URI` points to a database whose name ends exactly in `_demo`
- the Mongoose connection is to that same database

Do not put a production URI in `DEMO_MONGODB_URI`. Keep real credentials only in the ignored `.env` file and do not commit it. Start from `.env.example` for a disposable local/dev setup. For Atlas, create a separate demo database such as `school_platform_demo` and use its URI only in the demo variable. To run the API against the same seeded database, set `MONGODB_URI` to that demo URI in a development-only environment; the seeder itself still uses only `DEMO_MONGODB_URI`.

## Seed

In PowerShell, configure a disposable development database and explicitly opt in for the current terminal:

```powershell
$env:NODE_ENV = "development"
$env:ALLOW_DEMO_SEED = "true"
$env:DEMO_MONGODB_URI = "mongodb://127.0.0.1:27017/school_platform_demo"
$env:MONGODB_URI = $env:DEMO_MONGODB_URI # only if you will run the API against this same local demo DB
npm run seed:dev
```

On first seed, generated login credentials are written to `backend/.demo-credentials.json`. This file is ignored by Git; treat it as a secret, share only with authorized testers, and do not paste it into tickets or commit it. Re-running the seed upserts the same manifest-owned IDs, preserves the original date anchor and generated passwords, and does not add duplicate demo records. Keep `DEMO_CREDENTIALS_PATH` unset unless you intentionally want to store this file at another protected location.

## Test accounts and checks

The credential file contains the exact passwords. The fictional email/role matrix is:

| Role | Email |
| --- | --- |
| Super admin | `school-admin@example.com` |
| Principal | `principal.north@example.com`, `principal.south@example.com` |
| Teacher | `teacher.math@example.com`, `teacher.science@example.com`, `teacher.south@example.com` |
| Accountant | `accountant.north@example.com`, `accountant.south@example.com` |
| Student | `student.ava@example.com`, `student.noah@example.com`, `student.mia@example.com`, `student.eli@example.com` |
| Parent | `parent.lee@example.com`, `parent.park@example.com`, `parent.khan@example.com` |

One demo teacher account is disabled to check inactive-account login rejection. One accountant requires a password change. The fixture includes two campuses, four classes, twelve students, a week of attendance, timetables, notices, assignments/submissions, explicitly labeled fictional lecture/quiz fixtures, and unpaid/partial/paid/overdue/future invoices. Payment amounts are stored in the app's smallest currency unit. No AI provider is called; published lesson content is labeled as a test fixture.

Suggested smoke checklist after starting the API against the same demo DB and opening the app:

1. Sign in with the generated admin account; verify the two campuses/classes/students are visible.
2. Sign in as each principal and verify only their own campus is visible.
3. Sign in as each teacher and verify only assigned class/subject data is accessible; the disabled teacher must fail login.
4. Sign in as a student and a parent; verify only linked student records, published learning items, and allowed finance information are returned.
5. Sign in as the accountant who requires a password change; protected endpoints should reject access until changed.
6. Verify attendance, submissions/grades, quiz scores, and invoice/payment states. Attempts to read another branch/student or draft content should be rejected or filtered.
7. Check unauthenticated protected endpoints return `401`, and role-inappropriate admin actions return `403`.

## Reset

Reset has the same three environment gates and uses only the `_demo` URI. It reads the seed manifest and deletes only the exact IDs recorded there. Before deleting, it checks for records outside the manifest that reference seeded records; if any are found, reset stops without deleting seed data. Unrelated records are not deleted. The credentials file is intentionally retained so a later reseed keeps the same test passwords.

```powershell
$env:NODE_ENV = "development"
$env:ALLOW_DEMO_SEED = "true"
$env:DEMO_MONGODB_URI = "mongodb://127.0.0.1:27017/school_platform_demo"
npm run seed:dev:reset
```

Unset the opt-in after use with `Remove-Item Env:ALLOW_DEMO_SEED` (and clear the URI variables if they are no longer needed). Never run seed/reset against production or a database that contains valuable data.
