const { ObjectId } = require('mongodb');
const { schoolObjectId, createSchoolDatabase } = require('./schoolDatabase');

function unavailable(message, statusCode = 503, code = 'INTEGRATION_SCHOOL_SCOPE_REQUIRED') {
  return Object.assign(new Error(message), { code, statusCode });
}

function isLegacySingleSchoolMode() {
  return String(process.env.LEGACY_SINGLE_SCHOOL_MODE || '').trim().toLowerCase() === 'true';
}

function schoolValuesFor(schoolId) {
  if (!schoolId) return [];
  const canonical = schoolId instanceof ObjectId ? schoolId : schoolObjectId(schoolId);
  return [canonical, canonical.toHexString()];
}

function schoolFieldMatch(schoolId, field = 'schoolId') {
  if (!schoolId) {
    return {
      $or: [
        { [field]: { $exists: false } },
        { [field]: null },
        { [field]: '' },
      ],
    };
  }
  const values = schoolValuesFor(schoolId);
  return { [field]: { $in: values } };
}

async function resolveVerifiedTenantScope(database, authenticatedRecord, options = {}) {
  const {
    requireBranch = false,
    allowLegacyIsolated = isLegacySingleSchoolMode(),
  } = options;

  if (!authenticatedRecord || authenticatedRecord.role === 'ultra_admin') {
    throw unavailable('Platform authority does not grant access to school records.', 403);
  }

  const {
    resolveBranchReference,
    referenceValues,
    referenceFieldFilter,
  } = require('./identityReferenceAdapter');

  const rawSchoolId = authenticatedRecord.schoolId;
  let schoolId = null;
  let school = null;
  let legacyIsolated = false;

  if (rawSchoolId == null || rawSchoolId === '') {
    if (!allowLegacyIsolated) {
      throw unavailable('The account needs an owner-verified canonical school mapping.');
    }
    legacyIsolated = true;
  } else {
    try {
      schoolId = schoolObjectId(rawSchoolId);
    } catch {
      throw unavailable('The account needs an owner-verified canonical school mapping.');
    }
    school = await database.collection('schools').findOne({ _id: schoolId });
    if (!school) {
      throw unavailable('The account school mapping does not resolve.');
    }
    if (
      school.isActive === false ||
      school.active === false ||
      ['suspended', 'deleted', 'archived'].includes(school.status)
    ) {
      throw unavailable('School access is suspended.', 403);
    }
  }

  let branch = null;
  if (requireBranch && !authenticatedRecord.branchId) {
    throw unavailable('Branch reference is missing or invalid.', 503, 'INTEGRATION_REFERENCE_UNRESOLVED');
  }
  if (authenticatedRecord.branchId) {
    branch = await resolveBranchReference(database, authenticatedRecord.branchId);
    if (branch.isActive === false || branch.active === false) {
      throw unavailable('Branch access is disabled.', 403, 'BRANCH_ACCESS_DENIED');
    }
    if (schoolId) {
      let branchSchool;
      try {
        branchSchool = schoolObjectId(branch.schoolId);
      } catch {
        throw unavailable('The branch needs an owner-verified canonical school mapping.');
      }
      if (!schoolId.equals(branchSchool)) {
        throw unavailable('Account and branch belong to different schools.', 403, 'SCHOOL_ACCESS_DENIED');
      }
    } else if (branch.schoolId != null && branch.schoolId !== '') {
      throw unavailable(
        'Legacy single-school account cannot access a tenant-scoped branch.',
        403,
        'SCHOOL_ACCESS_DENIED',
      );
    }
  }

  const schoolValues = schoolId ? schoolValuesFor(schoolId) : [];
  const schoolFilter = schoolFieldMatch(schoolId);
  const branchValues = branch ? referenceValues(branch) : [];
  const branchFilter = branch ? referenceFieldFilter('branchId', branch) : null;

  return {
    schoolId,
    schoolIdHex: schoolId ? schoolId.toHexString() : null,
    school,
    schoolValues,
    schoolFilter,
    branch,
    branchId: branch ? String(branch._id) : null,
    branchValues,
    branchFilter,
    legacyIsolated,
    scopedDb: schoolId ? createSchoolDatabase(database, schoolId) : null,
  };
}

async function verifiedSchoolDatabase(database, authenticatedRecord) {
  const scope = await resolveVerifiedTenantScope(database, authenticatedRecord, {
    allowLegacyIsolated: false,
  });
  return scope.scopedDb;
}

function isTenantScopeObject(candidate) {
  return Boolean(
    candidate &&
      typeof candidate === 'object' &&
      ('legacyIsolated' in candidate || 'schoolValues' in candidate || 'schoolFilter' in candidate),
  );
}

function recordMatchesSchoolScope(first, second, options = {}) {
  const [tenantScope, record] = isTenantScopeObject(first) ? [first, second] : [second, first];
  const { requireSchoolOnRecord = !tenantScope?.legacyIsolated, field = 'schoolId' } = options;
  if (!record || typeof record !== 'object') return false;
  const raw = record[field];
  if (tenantScope?.schoolId) {
    if (raw == null || raw === '') {
      return !requireSchoolOnRecord;
    }
    try {
      return tenantScope.schoolId.equals(schoolObjectId(raw));
    } catch {
      return false;
    }
  }
  return raw == null || raw === '';
}

function recordMatchesBranchScope(first, second, options = {}) {
  const [tenantScope, record] = isTenantScopeObject(first) ? [first, second] : [second, first];
  const { requireBranchOnRecord = true, branchField = 'branchId' } = options;
  if (!tenantScope?.branch) return true;
  if (!record || typeof record !== 'object') return false;
  const raw = record[branchField];
  if (raw == null || raw === '') return !requireBranchOnRecord;
  const allowed = new Set(tenantScope.branchValues.map(value => String(value)));
  return allowed.has(String(raw));
}

function assertRecordTenantScope(tenantScope, record, label = 'Record', options = {}) {
  const {
    requireSchoolOnRecord = !tenantScope?.legacyIsolated,
    requireBranchMatch = Boolean(tenantScope?.branch),
    requireBranchOnRecord = true,
    branchField = 'branchId',
    schoolField = 'schoolId',
  } = options;

  if (!record) {
    throw unavailable(`${label} was not found.`, 404, 'RECORD_NOT_FOUND');
  }

  const rawSchool = record[schoolField];
  if (tenantScope?.schoolId) {
    if (rawSchool == null || rawSchool === '') {
      if (requireSchoolOnRecord) {
        throw unavailable(`${label} is missing a verified school mapping.`, 503, 'INTEGRATION_SCHOOL_SCOPE_REQUIRED');
      }
    } else {
      let recordSchoolId;
      try {
        recordSchoolId = schoolObjectId(rawSchool);
      } catch {
        throw unavailable(`${label} has an invalid school mapping.`, 503, 'INTEGRATION_SCHOOL_SCOPE_REQUIRED');
      }
      if (!tenantScope.schoolId.equals(recordSchoolId)) {
        throw unavailable(`${label} belongs to a different school.`, 403, 'SCHOOL_ACCESS_DENIED');
      }
    }
  } else if (rawSchool != null && rawSchool !== '') {
    throw unavailable(
      `${label} belongs to a tenant school and cannot be accessed in legacy single-school mode.`,
      403,
      'SCHOOL_ACCESS_DENIED',
    );
  }

  if (requireBranchMatch && tenantScope?.branch) {
    const rawBranch = record[branchField];
    if (rawBranch == null || rawBranch === '') {
      if (requireBranchOnRecord) {
        throw unavailable(`${label} is missing a verified branch mapping.`, 503, 'INTEGRATION_REFERENCE_UNRESOLVED');
      }
    } else {
      const allowed = new Set(tenantScope.branchValues.map(value => String(value)));
      if (!allowed.has(String(rawBranch))) {
        throw unavailable(
          `The requested ${label.toLowerCase()} is outside the authenticated branch.`,
          403,
          'BRANCH_ACCESS_DENIED',
        );
      }
    }
  }

  return record;
}

function combineTenantFilter(tenantScope, filter = {}, options = {}) {
  const {
    includeBranch = Boolean(tenantScope?.branch),
    branchField = 'branchId',
    schoolField = 'schoolId',
  } = options;
  const clauses = [];
  if (filter && Object.keys(filter).length > 0) {
    clauses.push(filter);
  }
  if (tenantScope) {
    clauses.push(
      schoolField === 'schoolId' && tenantScope.schoolFilter
        ? tenantScope.schoolFilter
        : schoolFieldMatch(tenantScope.schoolId, schoolField),
    );
    if (includeBranch && tenantScope.branch) {
      const { referenceFieldFilter } = require('./identityReferenceAdapter');
      clauses.push(
        branchField === 'branchId' && tenantScope.branchFilter
          ? tenantScope.branchFilter
          : referenceFieldFilter(branchField, tenantScope.branch),
      );
    }
  }
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

function filterJoinedRecords(records, tenantScope, options = {}) {
  if (!Array.isArray(records) || !tenantScope) return Array.isArray(records) ? records : [];
  const {
    requireSchoolOnJoined = false,
    requireBranchOnJoined = false,
    checkBranch = Boolean(tenantScope.branch),
    branchField = 'branchId',
    schoolField = 'schoolId',
  } = options;
  return records.filter(item => {
    if (!item || typeof item !== 'object') return false;
    if (!recordMatchesSchoolScope(tenantScope, item, { requireSchoolOnRecord: requireSchoolOnJoined, field: schoolField })) {
      return false;
    }
    if (checkBranch && !recordMatchesBranchScope(tenantScope, item, { requireBranchOnRecord: requireBranchOnJoined, branchField })) {
      return false;
    }
    return true;
  });
}

module.exports = {
  unavailable,
  isLegacySingleSchoolMode,
  schoolObjectId,
  schoolValuesFor,
  schoolFieldMatch,
  verifiedSchoolDatabase,
  resolveVerifiedTenantScope,
  recordMatchesSchoolScope,
  recordMatchesBranchScope,
  assertRecordTenantScope,
  combineTenantFilter,
  filterJoinedRecords,
};
