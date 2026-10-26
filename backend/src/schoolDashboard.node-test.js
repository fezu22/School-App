const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ObjectId} = require('mongodb');
const schoolId = new ObjectId();
const foreignSchoolId = new ObjectId();
const branches = [{_id: new ObjectId(), schoolId, isActive: true}, {_id: new ObjectId(), schoolId: foreignSchoolId, isActive: true}];
let school = {_id: schoolId};
let reads = 0;
const scopedRows = filter => {
  reads++;
  assert.equal(String(filter.$and[0].schoolId), String(schoolId));
  return branches.filter(branch => String(branch.schoolId) === String(schoolId) && (filter.$and[1].isActive === undefined || branch.isActive === filter.$and[1].isActive));
};
const databasePath = require.resolve('./database');
require.cache[databasePath] = {id: databasePath, filename: databasePath, loaded: true, exports: {getDatabase: () => ({collection: name => name === 'schools' ? {findOne: async () => school} : {
  countDocuments: async filter => scopedRows(filter).length,
  find: filter => ({sort: () => ({toArray: async () => scopedRows(filter)})}),
}})}};
require('tsx/cjs/api').register();
const {getSuperAdminDashboardController} = require('./staff/src/controllers/admin.controller.ts');
const {getUsageStatusController} = require('./staff/src/controllers/usage.controller.ts');
async function dashboard(record) {
  let status;
  let body;
  await getSuperAdminDashboardController({authenticatedUserRecord: record}, {status(value) {status = value; return this;}, json(value) {body = value; return this;}});
  return {status, body};
}

test('integrated school administrator dashboard cannot count or list another school', async () => {
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  const result = await dashboard({role: 'super_admin', schoolId});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.branches, {total: 1, active: 1, inactive: 0, list: [branches[0]]});
  delete process.env.INTEGRATED_STAFF_ENABLED;
});

test('dashboard denies unmapped, suspended and platform actors before branch queries', async () => {
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  const before = reads;
  assert.equal((await dashboard({role: 'super_admin'})).status, 503);
  assert.equal((await dashboard({role: 'ultra_admin', schoolId})).status, 403);
  school = {_id: schoolId, status: 'suspended'};
  assert.equal((await dashboard({role: 'super_admin', schoolId})).status, 403);
  assert.equal(reads, before);
  delete process.env.INTEGRATED_STAFF_ENABLED;
});

test('integrated usage totals also require the immutable school predicate', async () => {
  process.env.INTEGRATED_STAFF_ENABLED = 'true';
  school = {_id: schoolId};
  let body;
  await getUsageStatusController({authenticatedUserRecord: {role: 'super_admin', schoolId}}, {status(value) {assert.equal(value, 200); return this;}, json(value) {body = value;}});
  assert.equal(body.data.branches.used, 1);
  assert.equal(body.data.users.used, 1);
  delete process.env.INTEGRATED_STAFF_ENABLED;
});
