const { ObjectId } = require('mongodb');

class IntegrationReferenceError extends Error {
  constructor(message, code = 'INTEGRATION_REFERENCE_UNRESOLVED', statusCode = 503) {
    super(message);
    this.name = 'IntegrationReferenceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function referenceQuery(reference, aliasField = 'id') {
  if (reference == null || reference === '') return null;
  if (reference instanceof ObjectId) {
    return { $or: [{ _id: reference }, { [aliasField]: reference.toHexString() }] };
  }
  if (typeof reference !== 'string' || !reference.trim()) return null;
  const value = reference.trim();
  const alternatives = [{ [aliasField]: value }];
  if (ObjectId.isValid(value)) alternatives.push({ _id: new ObjectId(value) });
  return { $or: alternatives };
}

function referenceFieldQuery(field, reference) {
  if (reference == null || reference === '') return null;
  if (reference instanceof ObjectId) {
    return { $or: [{ [field]: reference }, { [field]: reference.toHexString() }] };
  }
  if (typeof reference !== 'string' || !reference.trim()) return null;
  const value = reference.trim();
  const alternatives = [{ [field]: value }];
  if (ObjectId.isValid(value)) alternatives.push({ [field]: new ObjectId(value) });
  return { $or: alternatives };
}

function recordKey(record) {
  return record?._id == null ? null : String(record._id);
}

async function resolveRecordReference(db, collectionName, reference, options = {}) {
  const { aliasField = 'id', label = collectionName } = options;
  const query = referenceQuery(reference, aliasField);
  if (!query) {
    throw new IntegrationReferenceError(`${label} reference is missing or invalid.`);
  }
  const matches = await db.collection(collectionName).find(query).limit(3).toArray();
  const unique = new Map();
  for (const match of matches) unique.set(recordKey(match) || JSON.stringify(match), match);
  if (!unique.size) {
    throw new IntegrationReferenceError(`${label} reference does not resolve to an existing record.`);
  }
  if (unique.size > 1) {
    throw new IntegrationReferenceError(
      `${label} reference matches multiple records; resolve the conflicting IDs before access.`,
      'INTEGRATION_REFERENCE_CONFLICT',
      409,
    );
  }
  return [...unique.values()][0];
}

async function resolveUserReference(db, reference) {
  return resolveRecordReference(db, 'users', reference, { label: 'User' });
}

async function resolveUserForRole(db, reference, role) {
  const user = await resolveUserReference(db, reference);
  if (user.role !== role) {
    const error = new Error(`Authenticated user record is not authorized for the ${role} role.`);
    error.statusCode = 403;
    error.code = 'ROLE_ACCESS_DENIED';
    throw error;
  }
  return user;
}

async function resolveBranchReference(db, reference) {
  let id;
  if (reference instanceof ObjectId) id = reference;
  else if (typeof reference === 'string' && ObjectId.isValid(reference.trim())) {
    id = new ObjectId(reference.trim());
  } else {
    throw new IntegrationReferenceError(
      'Branch reference is unresolved; a valid existing branch ObjectId is required.',
    );
  }
  const branch = await db.collection('branches').findOne({ _id: id });
  if (!branch) {
    throw new IntegrationReferenceError(
      'Branch reference does not match an existing branch; protected access is denied.',
    );
  }
  return branch;
}

async function resolveObjectIdReference(db, collectionName, reference, label) {
  let id;
  if (reference instanceof ObjectId) id = reference;
  else if (typeof reference === 'string' && ObjectId.isValid(reference.trim())) {
    id = new ObjectId(reference.trim());
  } else {
    throw new IntegrationReferenceError(
      `${label} reference is unresolved; no alias mapping is configured.`,
    );
  }
  const record = await db.collection(collectionName).findOne({ _id: id });
  if (!record) {
    throw new IntegrationReferenceError(
      `${label} reference does not match an existing ${label.toLowerCase()}.`,
    );
  }
  return record;
}

function unresolvedClassReference() {
  throw new IntegrationReferenceError(
    'Class reference cannot be verified: the JS backend has no confirmed canonical class collection/ID mapping. Protected class-scoped access is denied until that contract is integrated.',
  );
}

function apiId(record, aliasField = 'id') {
  if (typeof record?.[aliasField] === 'string' && record[aliasField].trim()) {
    return record[aliasField];
  }
  return record?._id == null ? null : String(record._id);
}

function referenceValues(record, aliasField = 'id') {
  const values = [];
  if (typeof record?.[aliasField] === 'string' && record[aliasField].trim()) {
    values.push(record[aliasField]);
  }
  if (record?._id instanceof ObjectId) {
    values.push(record._id, record._id.toHexString());
  } else if (record?._id != null) {
    values.push(record._id, String(record._id));
  }
  return [...new Map(values.map(value => [
    `${typeof value}:${String(value)}`,
    value,
  ])).values()];
}

function referenceFieldFilter(field, record, aliasField = 'id') {
  const values = referenceValues(record, aliasField);
  return values.length ? { [field]: { $in: values } } : { [field]: null };
}

async function assertSameBranch(db, leftReference, rightReference) {
  const [left, right] = await Promise.all([
    resolveBranchReference(db, leftReference),
    resolveBranchReference(db, rightReference),
  ]);
  if (String(left._id) !== String(right._id)) {
    const error = new Error('The requested record is outside the authenticated branch.');
    error.statusCode = 403;
    error.code = 'BRANCH_ACCESS_DENIED';
    throw error;
  }
  return left;
}

module.exports = {
  IntegrationReferenceError,
  apiId,
  assertSameBranch,
  referenceFieldFilter,
  referenceFieldQuery,
  referenceQuery,
  referenceValues,
  resolveBranchReference,
  unresolvedClassReference,
  resolveObjectIdReference,
  resolveRecordReference,
  resolveUserReference,
  resolveUserForRole,
};
