const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ObjectId} = require('mongodb');
const {createSchoolDatabase} = require('./schoolDatabase');

function fixture() {
  const school = new ObjectId();
  const calls = [];
  const collection = new Proxy({}, {get: (_, method) => (...args) => {calls.push({method, args}); return args;}});
  return {school, calls, db: createSchoolDatabase({collection: () => collection}, school)};
}

test('school boundary rejects missing mappings and exposes no global database methods', () => {
  for (const id of [undefined, '', 'legacy-school', {}, {$ne: null}]) assert.throws(() => createSchoolDatabase({}, id));
  const {db} = fixture();
  assert.equal(db.command, undefined);
  for (const name of ['schools', 'platformAudit', 'system.users', '$cmd']) assert.throws(() => db.collection(name));
  assert.equal(db.collection('students').drop, undefined);
});

test('all reads and writes retain school scope despite caller supplied OR or conflicting school', () => {
  const {db, school, calls} = fixture();
  const c = db.collection('students');
  const filter = {$or: [{schoolId: new ObjectId()}, {}]};
  for (const method of ['find', 'findOne', 'countDocuments', 'deleteOne', 'deleteMany', 'findOneAndDelete']) c[method](filter);
  for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate']) c[method](filter, {$set: {name: 'Changed'}});
  for (const method of ['replaceOne', 'findOneAndReplace']) c[method](filter, {name: 'Changed'});
  for (const call of calls) assert.deepEqual(call.args[0], {$and: [{schoolId: school}, filter]});
  c.distinct('name', filter);
  assert.deepEqual(calls.at(-1).args[1], {$and: [{schoolId: school}, filter]});
});

test('inserts and replacements assign school ownership without mutating caller data', () => {
  const {db, school, calls} = fixture();
  const value = {name: 'Test fixture'};
  db.collection('students').insertOne(value);
  assert.equal(value.schoolId, undefined);
  assert.deepEqual(calls[0].args[0], {...value, schoolId: school});
  assert.throws(() => db.collection('students').insertOne({...value, schoolId: new ObjectId()}));
});

test('ownership mutations, pipeline updates, unsafe upserts and bulk escapes fail before driver invocation', () => {
  const {db, calls} = fixture();
  const c = db.collection('students');
  for (const value of [{$set: {schoolId: new ObjectId()}}, {$unset: {schoolId: ''}}, {$rename: {name: 'schoolId'}}, [{$set: {name: 'x'}}], {$set: {'schoolId.x': 1}}]) assert.throws(() => c.updateOne({}, value));
  assert.throws(() => c.updateOne({}, {$set: {name: 'x'}}, {upsert: true}));
  assert.throws(() => c.bulkWrite([{insertOne: {document: {name: 'Valid'}}}, {updateOne: {filter: {}, update: {$set: {schoolId: new ObjectId()}}}}]));
  assert.equal(calls.length, 0);
  c.bulkWrite([{insertOne: {document: {name: 'Valid'}}}, {deleteMany: {filter: {}}}]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args[0][0].insertOne.document.schoolId);
  assert.ok(calls[0].args[0][1].deleteMany.filter.$and[0].schoolId);
});

test('aggregation requires school match and rejects joins, nested pipelines and export writes', () => {
  const {db, school, calls} = fixture();
  const c = db.collection('students');
  c.aggregate([{$group: {_id: '$classId', count: {$sum: 1}}}]);
  assert.deepEqual(calls[0].args[0][0], {$match: {schoolId: school}});
  for (const stage of ['$lookup', '$unionWith', '$graphLookup', '$facet', '$out', '$merge', '$search', '$documents']) assert.throws(() => c.aggregate([{[stage]: {}}]));
  assert.throws(() => c.aggregate([{$project: {secret: {$function: {body: 'return 1', args: [], lang: 'js'}}}}]));
  assert.throws(() => c.find({$where: 'return true'}));
});
