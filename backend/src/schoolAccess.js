const {schoolObjectId, createSchoolDatabase} = require('./schoolDatabase');

function unavailable(message, statusCode = 503) {
  return Object.assign(new Error(message), {code: 'INTEGRATION_SCHOOL_SCOPE_REQUIRED', statusCode});
}

async function verifiedSchoolDatabase(database, authenticatedRecord) {
  if (!authenticatedRecord || authenticatedRecord.role === 'ultra_admin') {
    throw unavailable('Platform authority does not grant access to school records.', 403);
  }
  let schoolId;
  try { schoolId = schoolObjectId(authenticatedRecord.schoolId); }
  catch { throw unavailable('The account needs an owner-verified canonical school mapping.'); }
  const school = await database.collection('schools').findOne({_id: schoolId});
  if (!school) throw unavailable('The account school mapping does not resolve.');
  if (school.isActive === false || school.active === false || ['suspended', 'deleted', 'archived'].includes(school.status)) {
    throw unavailable('School access is suspended.', 403);
  }
  if (authenticatedRecord.branchId) {
    // Reuse the established exact-reference adapter; never infer a branch.
    const {resolveBranchReference} = require('./identityReferenceAdapter');
    const branch = await resolveBranchReference(database, authenticatedRecord.branchId);
    let branchSchool;
    try { branchSchool = schoolObjectId(branch.schoolId); }
    catch { throw unavailable('The branch needs an owner-verified canonical school mapping.'); }
    if (!schoolId.equals(branchSchool)) throw unavailable('Account and branch belong to different schools.', 403);
    if (branch.isActive === false || branch.active === false) throw unavailable('Branch access is disabled.', 403);
  }
  return createSchoolDatabase(database, schoolId);
}

module.exports = {verifiedSchoolDatabase};
