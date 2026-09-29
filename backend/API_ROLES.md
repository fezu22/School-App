# API by role

Login and shared endpoints (any signed-in user): `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`,
`POST /auth/password`, `GET /branding`, `GET /dashboard`, `GET /health`.

Every other endpoint lives in one role portal. A portal rejects other roles with 403.

| Portal | Roles | Code | Endpoints |
| --- | --- | --- | --- |
| `/student` | STUDENT | `src/roles/student/routes.js` | GET profile, attendance, timetable, notices, invoices, assignments, assignments/:id/submissions, lectures, lectures/:id, lectures/:id/attempts. POST assignments/:id/submissions, lectures/:id/attempts |
| `/parent` | PARENT | `src/roles/parent/routes.js` | Same reads as student, no POST (read-only) |
| `/finance` | ACCOUNTANT | `src/roles/finance/routes.js` | GET students, notices, invoices. POST invoices, invoices/:id/payments |
| `/staff` | SUPER_ADMIN, PRINCIPAL, TEACHER, ACADEMIC_COORDINATOR, EXAM_OFFICER, HR, LIBRARIAN, INVENTORY, TRANSPORT, HOSTEL, AUDITOR, IT_SUPPORT | `src/roles/staff/*.js` | branches, classes, students, attendance, notices, timetable, dashboard, teachers (`academics.js`), assignments (`assignments.js`), lectures (`lectures.js`), invoices (`invoices.js`), admin/* for SUPER_ADMIN only (`admin.js`: users, branches, branding, audit) |

Inside `/staff`, each endpoint still has its own role rules (for example only SUPER_ADMIN and PRINCIPAL
can list invoices, only SUPER_ADMIN can create invoices or record payments, teachers only see their
own classes and subjects).

Shared code used by several portals: `middleware/auth.js`, `models/`, `services/` (audit, ai, invoices, notices).
