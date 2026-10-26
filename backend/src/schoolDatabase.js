const {ObjectId} = require('mongodb');

// Shared native-driver boundary for legacy collections and Mongoose's raw
// connection.collection path. Adoption is explicit; this is not yet a global
// tenancy guarantee. Never derive school IDs from request parameters.
function denied(message = 'School database operation is not authorized.') {
  const error = new Error(message);
  error.code = 'SCHOOL_SCOPE_REQUIRED';
  error.statusCode = 403;
  return error;
}

function schoolObjectId(value) {
  const text = typeof value === 'string' ? value : value?.toHexString?.();
  if (typeof text !== 'string' || !/^[a-f0-9]{24}$/i.test(text)) {
    throw denied('A verified canonical school ID is required.');
  }
  return new ObjectId(text);
}

function createSchoolDatabase(database, verifiedSchoolId) {
  const schoolId = schoolObjectId(verifiedSchoolId);
  const rejectExecutable = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (['$where', '$function', '$accumulator'].includes(key)) throw denied();
      rejectExecutable(nested);
    }
  };
  const scope = filter => {
    rejectExecutable(filter);
    return {$and: [{schoolId}, filter || {}]};
  };
  const document = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw denied();
    if (value.schoolId !== undefined && !schoolId.equals(schoolObjectId(value.schoolId))) throw denied();
    return {...value, schoolId};
  };
  const update = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw denied();
    // Pipelines and arbitrary operators need a separate reviewed policy.
    const allowed = new Set(['$set', '$unset', '$inc', '$push', '$pull', '$addToSet', '$pop', '$min', '$max', '$currentDate', '$setOnInsert']);
    for (const [operator, fields] of Object.entries(value)) {
      if (!allowed.has(operator) || !fields || typeof fields !== 'object' || Array.isArray(fields)) throw denied();
      for (const key of Object.keys(fields)) {
        if (key === 'schoolId' || key.startsWith('schoolId.') || key.includes('$')) throw denied('School ownership is immutable.');
      }
    }
    return value;
  };
  const options = value => {
    // Upsert extraction from arbitrary filters is driver-dependent. Require
    // an explicit scoped insert until unique tenant keys have been audited.
    if (value?.upsert || value?.bypassDocumentValidation) throw denied();
    return value;
  };
  const pipeline = stages => {
    if (!Array.isArray(stages)) throw denied();
    rejectExecutable(stages);
    const allowed = new Set(['$match', '$sort', '$skip', '$limit', '$project', '$group', '$count', '$unwind', '$addFields', '$set', '$unset', '$replaceRoot', '$replaceWith', '$sortByCount']);
    // Disallow joins, nested pipelines, writes and server JS until separately
    // scoped. A leading match alone cannot secure lookup/unionWith/out/merge.
    for (const stage of stages) {
      if (!stage || Object.keys(stage).length !== 1 || !allowed.has(Object.keys(stage)[0])) throw denied();
    }
    return [{$match: {schoolId}}, ...stages];
  };
  return Object.freeze({
    collection(name) {
      if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || name === 'schools' || name.startsWith('platform')) throw denied();
      const collection = database.collection(name);
      const operations = {
        find: (filter, opts) => collection.find(scope(filter), options(opts)),
        findOne: (filter, opts) => collection.findOne(scope(filter), options(opts)),
        countDocuments: (filter, opts) => collection.countDocuments(scope(filter), options(opts)),
        distinct: (field, filter, opts) => collection.distinct(field, scope(filter), options(opts)),
        insertOne: (value, opts) => collection.insertOne(document(value), options(opts)),
        insertMany: (values, opts) => collection.insertMany(values.map(document), options(opts)),
        aggregate: (stages, opts) => collection.aggregate(pipeline(stages), options(opts)),
      };
      for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
        operations[method] = (filter, value, opts) => collection[method](scope(filter), update(value), options(opts));
      }
      for (const method of ['deleteOne', 'deleteMany', 'findOneAndDelete']) {
        operations[method] = (filter, opts) => collection[method](scope(filter), options(opts));
      }
      for (const method of ['replaceOne', 'findOneAndReplace']) {
        operations[method] = (filter, value, opts) => collection[method](scope(filter), document(value), options(opts));
      }
      operations.bulkWrite = (writes, opts) => {
        const scoped = writes.map(write => {
          if (!write || Object.keys(write).length !== 1) throw denied();
          const [method, operation] = Object.entries(write)[0];
          if (!operation || typeof operation !== 'object') throw denied();
          options(operation);
          if (method === 'insertOne') return {insertOne: {...operation, document: document(operation.document)}};
          if (['updateOne', 'updateMany'].includes(method)) return {[method]: {...operation, filter: scope(operation.filter), update: update(operation.update)}};
          if (method === 'replaceOne') return {replaceOne: {...operation, filter: scope(operation.filter), replacement: document(operation.replacement)}};
          if (['deleteOne', 'deleteMany'].includes(method)) return {[method]: {...operation, filter: scope(operation.filter)}};
          throw denied();
        });
        return collection.bulkWrite(scoped, options(opts));
      };
      // No raw collection, command, watch, drop, index or database escape hatch.
      return Object.freeze(operations);
    },
  });
}

module.exports = {createSchoolDatabase, schoolObjectId};
