const {schoolObjectId, createSchoolDatabase} = require('./schoolDatabase');

function unavailable(message, statusCode = 503) {
  return Object.assign(new Error(message), {code: 'INTEGRATION_SCHOOL_SCOPE_REQUIRED', statusCode});
}

async function resolveSchoolAuthority(database, authenticatedRecord, {session, allowBranchSchool = false} = {}) {
  if (!authenticatedRecord || authenticatedRecord.role === 'ultra_admin') {
    throw unavailable('Platform authority does not grant access to school records.', 403);
  }
  if (authenticatedRecord.active === false || authenticatedRecord.isActive === false) throw unavailable('School authority is unavailable.', 403);
  const options = session ? {session} : {};
  let branch;
  if (allowBranchSchool && authenticatedRecord.branchId) {
    let branchId;
    try {branchId = schoolObjectId(authenticatedRecord.branchId);}
    catch {throw unavailable('School authority is unavailable.', 403);}
    branch = await database.collection('branches').findOne({_id: branchId}, options);
    if (!branch) throw unavailable('School authority is unavailable.', 403);
  }
  let schoolId;
  try { schoolId = schoolObjectId(authenticatedRecord.schoolId ?? (allowBranchSchool ? branch?.schoolId : undefined)); }
  catch { throw unavailable('The account needs an owner-verified canonical school mapping.'); }
  const school = await database.collection('schools').findOne({_id: schoolId}, options);
  if (!school) throw unavailable('The account school mapping does not resolve.');
  if (school.isActive === false || school.active === false || ['suspended', 'deleted', 'archived'].includes(school.status)) {
    throw unavailable('School access is suspended.', 403);
  }
  if (authenticatedRecord.branchId) {
    // Reuse the established exact-reference adapter; never infer a branch.
    const {resolveBranchReference} = require('./identityReferenceAdapter');
    branch ??= await resolveBranchReference(database, authenticatedRecord.branchId);
    let branchSchool;
    try { branchSchool = schoolObjectId(branch.schoolId); }
    catch { throw unavailable('The branch needs an owner-verified canonical school mapping.'); }
    if (!schoolId.equals(branchSchool)) throw unavailable('Account and branch belong to different schools.', 403);
    if (branch.isActive === false || branch.active === false) throw unavailable('Branch access is disabled.', 403);
  }
  return {schoolId, school, branch};
}

async function verifiedSchoolDatabase(database, authenticatedRecord) {
  const {schoolId} = await resolveSchoolAuthority(database, authenticatedRecord);
  return createSchoolDatabase(database, schoolId);
}

module.exports = {verifiedSchoolDatabase, resolveSchoolAuthority};
