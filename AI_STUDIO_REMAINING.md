> Deep testing update (2026-10-26): see [DEEP_TEST_REPORT.md](DEEP_TEST_REPORT.md) for reproduced defects, fixes and current measured results. Platform-wide isolation, Ultra Admin, provider and native device work remain unfinished.

> Local follow-up (2026-10-25): integration is merged; a school database boundary and scoped integrated administrator dashboard are implemented and tested. Global adoption is unfinished; Ultra Admin is not implemented. This Windows machine now runs ephemeral MongoDB replica-set tests, so the original mongod environment limitation below is historical. Integrated shared-session/provider/device verification is still required. See [LOCAL_INTEGRATION_REPORT.md](LOCAL_INTEGRATION_REPORT.md) and [SCHOOL_ISOLATION_AUDIT.md](SCHOOL_ISOLATION_AUDIT.md). The unfinished checklist below remains open.

# Remaining implementation handoff

Continue from this project, not from an earlier ZIP. Preserve its existing source and passing tests. Do not describe it as complete.

## Unfinished development (not external configuration)
1. Implement platform-wide school/tenant isolation across BOTH MongoDB access paths, raw operations, realtime, files, background jobs and exports. Current school scoping exists only in the new paper module. Do not add Ultra Admin school onboarding before tenant isolation has adversarial tests.
2. Implement Ultra Admin, controlled bootstrap, school provisioning, school Super Admin invitations, suspension, plans, limits and audit. Keep platform permissions distinct from school data access.
3. Finish shared-session live-class transaction tests on a machine where isolated MongoDB replica sets run. Review backend/src/staff/src/services/live-lesson.service.ts. Keep the integrated route disabled until verified. Preserve login revocation/expiry and background classroom enforcement.
4. Add verified Parent live-class recipient authorization and notifications. Send invitation IDs, then mint individual tokens after an authorized open; do not send bearer/join tokens in notifications. Existing staff live router supports Teacher/Student only.
5. Finish academic producer/consumer compatibility: Student legacy IDs, enrollment, timetable, results, attendance and homework versus staff ObjectId schemas. Audit contracts before writing adapters. Fix chat/UI gaps without weakening branch or parent-link checks.
6. Apply the two original UI design ZIPs to all native role screens. They are not included as implemented screens in this checkpoint. Keep JS/JSX for owned roles. Preserve API functionality and honest unavailable states.
7. Extend exam papers with school logos, embedded language fonts/Urdu layout, question types/banks, school-specific review/approval/publication, and authorized template editing/versioning. Existing templates/PDF module is functional but intentionally bounded.
8. Implement/test real hosted card gateway and multi-invoice settlement against an official chosen provider. Never collect PAN/CVV, fake success or settle multiple schools to an unconfirmed platform merchant.
9. Complete recorded-lesson storage/jobs and Teacher-reviewed AI generation. Make publication explicit and tenant-scoped.
10. Verify finance extra-charge batches, payroll and expenses end to end, and any remaining PTM/calendar/transport providers. Do not assume a navigation item proves implementation.
11. Run all role workflows on Android, native PDF share/print and current dependencies. No APK was requested.

## Owner/provider setup required (AI cannot fabricate these)
- Owner-confirmed school/branch/class/user mappings and real authorized accounts. Do not migrate live IDs by guessing.
- ZEGO app credentials/permissions, provider account and an actual sandbox/live classroom test.
- Chosen card processor merchant/sandbox credentials, school settlement policy and official integration contract.
- AI, object-storage and push/email provider accounts/keys where required.
- A development machine capable of running an isolated MongoDB replica set and native Android builds/device verification. The current environment refused mongod startup; do not replace this with a live database test.

For each feature trace UI → API → authorization → persistence → response/UI. Report unit, fixture, isolated MongoDB, provider and device evidence separately. No production migrations, dummy data, deployments or real transactions without explicit authorization.
