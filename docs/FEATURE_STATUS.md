# Implemented scope versus remaining work

| Area | Current implementation | Remaining |
|---|---|---|
| Accounts | Super Admin creates accounts, role scopes, temporary-password change, secure mobile token storage, disable/revoke, edit scopes | Email invitations, reset email, MFA, granular per-action custom roles |
| Branches/classes | Create/list branch, class, section, session, subjects; scoped lists | Edit/archive, capacity, promotion |
| Students/parents | Admissions basics, guardian details, verified-by-admin child links, scoped records | Document uploads, certificates, board records, student transfers |
| Attendance | Per-student present/absent/late/excused, date roster, save/update and audit, parent/student view | Approval for corrections, push absence alerts, staff attendance |
| Timetable | Create/list periods, class overlap rejection | Room/teacher clash detection, substitutions |
| Notices | Branch/class notices, scoped reads | SMS/push/email, delivery tracking, approval workflow |
| Assignments | Draft/publish, text answers, duplicate prevention, marks/feedback, parent read access | Attachments, resubmission, rubric builder, late policies |
| AI lessons | Real provider integration for transcript summary/topics/homework/MCQs, teacher approval, published access | Audio/stream transcription, durable queue, advanced grounding/evaluations |
| AI checking | Text-answer suggested score and feedback, teacher review; deterministic MCQ scoring | Scans/photos, OMR, handwritten math/diagrams, calibrated subject rubrics |
| Fees | Invoice create/list, partial/full payment, balance, idempotency, receipt list, transactions | Printable invoices, refunds, discounts, cash closing, bank reconciliation |
| Audit | Admin-readable trail for critical writes | Export, retention policies, fuller field-change history |
| Specialist roles | Accounts and restricted notices | HR, payroll, library, inventory, transport, hostel workflows |
| Parent tracking | Own attendance, homework results, fee ledger | Bus GPS, gate check-in/out, pickup verification, real-time timeline |

No percentage completion claim is made: the original master scope includes extensive modules beyond this tested core release. No blank modules are presented as working features.
