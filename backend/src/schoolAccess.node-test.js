const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ObjectId} = require('mongodb');
const {verifiedSchoolDatabase} = require('./schoolAccess');

test('school authority requires a real mapping and excludes platform authority', async () => {
  const schoolId = new ObjectId();
  const db = {collection: () => ({findOne: async () => ({_id: schoolId})})};
  for (const actor of [undefined, {role: 'super_admin'}, {role: 'ultra_admin', schoolId}]) {
    await assert.rejects(verifiedSchoolDatabase(db, actor));
  }
  const scoped = await verifiedSchoolDatabase(db, {role: 'super_admin', schoolId});
  assert.equal(scoped.command, undefined);
});

test('missing and suspended schools fail closed without creating records', async () => {
  const schoolId = new ObjectId();
  for (const school of [null, {_id: schoolId, isActive: false}, {_id: schoolId, active: false}, {_id: schoolId, status: 'suspended'}]) {
    const db = {collection: () => ({findOne: async () => school})};
    await assert.rejects(verifiedSchoolDatabase(db, {role: 'teacher', schoolId}));
  }
});

test('verified branch mapping cannot cross schools or fall back to an inferred school', async () => {
  const schoolId = new ObjectId();
  const branchId = new ObjectId();
  let branch = {_id: branchId, schoolId: new ObjectId()};
  const db = {collection: name => name === 'schools' ? {findOne: async () => ({_id: schoolId})} : {
    findOne: async () => branch,
  }};
  const actor = {role: 'principal', schoolId, branchId};
  await assert.rejects(verifiedSchoolDatabase(db, actor), /different schools/);
  branch = {_id: branchId};
  await assert.rejects(verifiedSchoolDatabase(db, actor), /owner-verified/);
  branch.schoolId = schoolId;
  assert.ok(await verifiedSchoolDatabase(db, actor));
});
