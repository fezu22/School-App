> Deep testing update (2026-10-26): see [DEEP_TEST_REPORT.md](DEEP_TEST_REPORT.md) for reproduced defects, fixes and current measured results. Platform-wide isolation, Ultra Admin, provider and native device work remain unfinished.

> Security audit update (2026-10-26): [SECURITY_AUDIT_100.md](SECURITY_AUDIT_100.md) records 100/100 selected cases passed, 16 reproduced failures fixed in 6 groups, and 106 backend regressions passed. Integrated branch operations/selector and mapped-school session checks now have additional protections. Platform-wide school isolation and Ultra Admin remain incomplete; the checkpoint below is historical.

# School isolation implementation checkpoint — 2026-10-25

Platform-wide isolation is **not complete**. Ultra Admin onboarding remains unimplemented and must not be enabled before adversarial tests cover every school-data entry point. Existing school Super Admin is not a platform administrator.

## Implemented in this merge

- `backend/src/schoolDatabase.js` provides an explicit native collection boundary usable with both the MongoDB driver and Mongoose raw connections. Reads, counts, distinct operations, updates, deletes, replacements and bulk writes carry an immutable canonical school predicate. Inserts carry school ownership. Unsafe upserts, update pipelines, joins, nested aggregation pipelines, aggregation writes and unrestricted database methods are withheld.
- `backend/src/schoolAccess.js` accepts an authenticated database record, requires an existing canonical school, denies suspended schools and platform identities, and verifies any branch against that school. It never guesses mappings or creates records.
- The integrated Super Admin dashboard and usage controller use this boundary for school branch lists and branch/user counts. Missing account or branch mappings produce a configuration error.
- Adversarial fixture tests cover conflicting school filters, ownership changes, bulk failures, unsafe aggregations, missing mappings, suspended schools and cross-school branches. These are fixture tests, not proof of platform-wide coverage.

## Required adoption work

1. Establish the owner-approved school ownership contract for existing user, branch, student, enrollment and legacy alias records. Write a separately reviewed migration/readiness tool; do not infer mappings or run mutations on live data.
2. Adopt the boundary throughout legacy routes and services. Authentication/session lookup is a distinct, minimal cross-school identity operation and must not expose school records.
3. Implement Mongoose query/document middleware or tenant-bound model connections for every staff model. The new native wrapper does **not** automatically scope Mongoose models. Add tenant schema fields and compound indexes without silently deleting existing uniqueness constraints.
4. Audit cross-reference ownership on writes; a scoped insert alone cannot validate that a referenced class/student/teacher belongs to the same school.
5. Carry a verified school context through WebSocket ticket consumption, recipient authorization, attachment storage/downloads, exports and queued/background jobs. Partition caches and idempotency keys. Revalidate suspension and revoked authority.
6. Review retained records and immutable historical evidence rather than using present enrollment as a universal history filter. Preserve branch and verified Parent-child restrictions.
7. Run adversarial HTTP and real isolated replica-set tests across both access paths before building Ultra Admin bootstrap, provisioning, invitations, suspension, plans, limits and audit. Keep platform permissions separate from school-data permissions.

## Known unscoped examples requiring work

- Staff `services/admin.service.ts`, `branch.service.ts`, `usage.service.ts` and provisioning operations still contain global model queries. The integrated dashboard/usage controllers are scoped; legacy direct service callers are not automatically scoped.
- Staff raw `mongoose.connection.collection` operations appear in academic work, attendance, evidence, communications, timetable and live-class services.
- Legacy `getDatabase()` remains a raw database for existing workflows; adopting the new wrapper in one controller does not protect those other workflows.
- `chatRealtime.js` and payment reconciliation require tenant-aware job/socket contexts.
- Integrated administrator session management is explicitly unavailable until school-scoped shared-session listing/revocation, identity ambiguity and transactional reassignment/revocation races are implemented and tested. Do not wire it to the partner JWT session collection.
- School-scoped exam papers alone do not establish safe multi-school operation.

Generate a static starting inventory with `node backend/scripts/audit-school-isolation.js`. Its output is an inventory, not verification of coverage.
