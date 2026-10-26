'use strict';

// Read-only repair planner. This file deliberately contains no database write
// operations and has no apply mode. It inspects live documents/indexes and
// emits candidate actions for human review only.
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const { MongoClient } = require('mongodb');
const { getMongoConfig } = require('../src/database');

const RULES = {
  userId: 'users.id (auth.js resolves sessions and login by this field)',
  studentId: 'students.id (student/parent APIs and parentChildLinks use this field)',
  studentOwner: 'students.userId -> users.id',
  parentId: 'parents.id and parents.userId -> users.id',
  parentChild: 'parentChildLinks.parentUserId -> users.id; studentId -> students.id',
  branchId:
    'string branchId is carried by users/students/invoices/payments; no branches lookup defines whether it means branches._id, branches.id, or branches.code',
  invoiceId: 'invoices.id (payments.invoiceId references it)',
  financeInvoiceStatuses: ['due', 'overdue', 'partial', 'paid'],
  parentCheckoutPartialInvoiceStatus: 'partially_paid (code currently differs from Finance partial)',
};

function printable(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && value._bsontype === 'ObjectId') {
    return value.toString();
  }
  return String(value);
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function hasIndex(indexes, keys, unique = true) {
  const target = JSON.stringify(keys);
  return indexes.some(
    index => JSON.stringify(index.key) === target && Boolean(index.unique) === unique,
  );
}

async function duplicateSummary(collection, fields) {
  const match = Object.fromEntries(
    fields.map(field => [field, { $type: 'string' }]),
  );
  const key =
    fields.length === 1
      ? `$${fields[0]}`
      : Object.fromEntries(fields.map(field => [field, `$${field}`]));
  const [result] = await collection
    .aggregate([
      { $match: match },
      { $group: { _id: key, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      {
        $group: {
          _id: null,
          duplicateGroups: { $sum: 1 },
          affectedDocuments: { $sum: '$count' },
        },
      },
    ])
    .toArray();
  return result
    ? { duplicateGroups: result.duplicateGroups, affectedDocuments: result.affectedDocuments }
    : { duplicateGroups: 0, affectedDocuments: 0 };
}

async function missingFieldCount(collection, fields) {
  const missing = fields.map(field => ({
    $or: [
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: '' },
    ],
  }));
  return collection.countDocuments({ $or: missing });
}

async function readAll(collection, projection) {
  return collection.find({}, { projection }).toArray();
}

async function exactReferenceAudit(db, sourceName, field, targetName, targetField) {
  const source = db.collection(sourceName);
  const target = db.collection(targetName);
  const sourceRows = await readAll(source, { _id: 1, id: 1, userId: 1, parentUserId: 1, studentId: 1, branchId: 1, [field]: 1 });
  const targetRows = await readAll(target, { _id: 1, id: 1, userId: 1, role: 1, code: 1, [targetField]: 1 });
  const targetValues = targetRows.map(row => ({ value: row[targetField], row }));
  return sourceRows
    .filter(row => isPresent(row[field]))
    .map(row => {
      const matches = targetValues
        .filter(candidate =>
          isPresent(candidate.value) &&
          printable(candidate.value) === printable(row[field]),
        )
        .map(candidate => ({
          targetMongoId: printable(candidate.row._id),
          targetId: printable(candidate.row.id),
          targetUserId: printable(candidate.row.userId),
          targetRole: candidate.row.role || null,
        }));
      return {
        sourceCollection: sourceName,
        sourceMongoId: printable(row._id),
        sourceId: printable(row.id),
        sourceReference: printable(row[field]),
        referenceField: field,
        targetCollection: targetName,
        targetField,
        exactMatchCount: matches.length,
        matches,
      };
    });
}

async function main() {
  if (process.argv.slice(2).some(argument => argument !== '--dry-run')) {
    throw new Error('This script only supports --dry-run and has no apply mode.');
  }

  const { uri, databaseName } = getMongoConfig();
  let clusterHost = 'unparsed';
  try {
    clusterHost = new URL(uri).hostname;
  } catch {
    // Never include the URI in a diagnostic.
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    const db = client.db(databaseName);
    await db.command({ ping: 1 });
    const collectionNames = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map(collection => collection.name)
      .sort();
    const collections = new Set(collectionNames);

    const counts = {};
    const indexes = {};
    for (const name of collectionNames) {
      const collection = db.collection(name);
      counts[name] = await collection.countDocuments({});
      indexes[name] = (await collection.listIndexes().toArray()).map(index => ({
        name: index.name,
        key: index.key,
        unique: Boolean(index.unique),
        partialFilterExpression: index.partialFilterExpression || null,
        expireAfterSeconds: index.expireAfterSeconds ?? null,
      }));
    }

    const branches = collections.has('branches')
      ? await readAll(db.collection('branches'), { _id: 1, id: 1, code: 1, schoolId: 1 })
      : [];
    const branchRegistry = branches.map(branch => ({
      mongoId: printable(branch._id),
      id: printable(branch.id),
      code: printable(branch.code),
      schoolId: printable(branch.schoolId),
    }));

    const branchReferences = [];
    for (const name of ['users', 'students', 'invoices', 'payments', 'attendance', 'attendances', 'timetable', 'homework', 'submissions', 'results', 'progress']) {
      if (!collections.has(name)) continue;
      const docs = await readAll(db.collection(name), {
        _id: 1,
        id: 1,
        userId: 1,
        studentId: 1,
        branchId: 1,
        demoRecord: 1,
      });
      for (const doc of docs.filter(item => isPresent(item.branchId))) {
        const matches = [];
        for (const branch of branches) {
          for (const [field, value] of [['id', branch.id], ['code', branch.code], ['_id', branch._id]]) {
            if (isPresent(value) && printable(value) === printable(doc.branchId)) {
              matches.push({ branchMongoId: printable(branch._id), matchedField: field });
            }
          }
        }
        branchReferences.push({
          collection: name,
          recordMongoId: printable(doc._id),
          recordId: printable(doc.id),
          userId: printable(doc.userId),
          studentId: printable(doc.studentId),
          branchId: printable(doc.branchId),
          demoRecord: Boolean(doc.demoRecord),
          exactRegistryMatchCount: matches.length,
          registryMatches: matches,
          disposition: matches.length === 1 ? 'exact-match; no correction proposed' : 'unresolved; do not rewrite without canonical branch contract',
        });
      }
    }

    const parentLinks = [];
    if (collections.has('parents') && collections.has('users')) {
      const parentRows = await readAll(db.collection('parents'), { _id: 1, id: 1, userId: 1, studentIds: 1, demoRecord: 1 });
      for (const parent of parentRows) {
        const referencedUserId = parent.userId || parent.id;
        const userMatches = await db.collection('users').find(
          { id: referencedUserId },
          { projection: { _id: 1, id: 1, role: 1 } },
        ).toArray();
        const links = collections.has('parentChildLinks')
          ? await readAll(db.collection('parentChildLinks'), { _id: 1, parentUserId: 1, studentId: 1, status: 1, verified: 1, revokedAt: 1, demoRecord: 1 })
          : [];
        const linkedRows = links.filter(link => printable(link.parentUserId) === printable(referencedUserId));
        parentLinks.push({
          parentMongoId: printable(parent._id),
          parentId: printable(parent.id),
          parentUserId: printable(parent.userId),
          matchingUsersByUsersId: userMatches.map(user => ({ id: printable(user.id), role: user.role || null })),
          linkedChildren: linkedRows.map(link => ({
            linkMongoId: printable(link._id),
            studentId: printable(link.studentId),
            status: link.status || null,
            verified: Boolean(link.verified),
            revoked: isPresent(link.revokedAt),
            demoRecord: Boolean(link.demoRecord),
          })),
          disposition: userMatches.length === 1 && String(userMatches[0].role).toLowerCase() === 'parent'
            ? 'user-link-valid; no correction proposed'
            : 'unresolved; do not create or reassign a user automatically',
        });
      }
    }

    const demos = [];
    for (const name of collectionNames) {
      const docs = await readAll(db.collection(name), {
        _id: 1,
        id: 1,
        userId: 1,
        parentUserId: 1,
        studentId: 1,
        invoiceId: 1,
        branchId: 1,
        status: 1,
        demoRecord: 1,
      });
      for (const doc of docs) {
        if (!doc.demoRecord) continue;
        demos.push({
          collection: name,
          mongoId: printable(doc._id),
          id: printable(doc.id),
          userId: printable(doc.userId),
          parentUserId: printable(doc.parentUserId),
          studentId: printable(doc.studentId),
          invoiceId: printable(doc.invoiceId),
          branchId: printable(doc.branchId),
          status: doc.status || null,
          action: 'preserve; excluded from repair proposals',
        });
      }
    }

    const indexRules = [
      { collection: 'users', fields: ['id'], keys: { id: 1 }, partialFilterExpression: { id: { $type: 'string' } } },
      { collection: 'users', fields: ['emailLower'], keys: { emailLower: 1 }, partialFilterExpression: { emailLower: { $type: 'string' } } },
      { collection: 'students', fields: ['id'], keys: { id: 1 }, partialFilterExpression: { id: { $type: 'string' } } },
      { collection: 'parents', fields: ['userId'], keys: { userId: 1 }, partialFilterExpression: { userId: { $type: 'string' } } },
      { collection: 'parentChildLinks', fields: ['parentUserId', 'studentId'], keys: { parentUserId: 1, studentId: 1 }, partialFilterExpression: { revokedAt: null, parentUserId: { $type: 'string' }, studentId: { $type: 'string' } } },
      { collection: 'invoices', fields: ['id'], keys: { id: 1 }, partialFilterExpression: { id: { $type: 'string' } } },
      { collection: 'notifications', fields: ['id'], keys: { id: 1 }, partialFilterExpression: { id: { $type: 'string' } } },
    ];
    const uniqueIndexProposals = [];
    for (const rule of indexRules) {
      if (!collections.has(rule.collection)) {
        uniqueIndexProposals.push({ ...rule, disposition: 'collection absent; blocked until schema exists' });
        continue;
      }
      const collection = db.collection(rule.collection);
      const duplicateKeys = await duplicateSummary(collection, rule.fields);
      const missingFields = await missingFieldCount(collection, rule.fields);
      const alreadyPresent = hasIndex(indexes[rule.collection], rule.keys, true);
      uniqueIndexProposals.push({
        collection: rule.collection,
        keys: rule.keys,
        unique: true,
        partialFilterExpression: rule.partialFilterExpression,
        duplicateKeys,
        documentsMissingKey: missingFields,
        alreadyPresent,
        disposition: alreadyPresent
          ? 'already present'
          : duplicateKeys.duplicateGroups > 0
            ? 'blocked by duplicate values; resolve manually first'
            : 'proposed only; review contract and missing-key count before applying',
      });
    }

    const statusProposals = [];
    const statusObservations = {};
    if (collections.has('invoices')) {
      const invoices = await readAll(db.collection('invoices'), { _id: 1, id: 1, studentId: 1, branchId: 1, amount: 1, status: 1, demoRecord: 1 });
      const payments = collections.has('payments')
        ? await readAll(db.collection('payments'), { invoiceId: 1, studentId: 1, branchId: 1, amount: 1, status: 1, demoRecord: 1 })
        : [];
      for (const invoice of invoices) {
        if (invoice.demoRecord) continue;
        const eligiblePayments = payments.filter(payment =>
          !payment.demoRecord &&
          payment.status === 'confirmed' &&
          printable(payment.invoiceId) === printable(invoice.id) &&
          printable(payment.studentId) === printable(invoice.studentId) &&
          printable(payment.branchId) === printable(invoice.branchId),
        );
        const amount = Number(invoice.amount);
        const paid = eligiblePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const target = !Number.isFinite(amount) || amount <= 0
          ? null
          : paid <= 0
            ? 'due'
            : paid >= amount
              ? 'paid'
              : 'partial';
        if (target && invoice.status !== target && ['issued', 'partially_paid', 'partial', 'due', 'paid', 'overdue'].includes(invoice.status)) {
          statusProposals.push({
            collection: 'invoices',
            invoiceMongoId: printable(invoice._id),
            invoiceId: printable(invoice.id),
            observedStatus: invoice.status || null,
            proposedStatus: target,
            confirmedNonDemoPaymentCount: eligiblePayments.length,
            basis: 'Finance status contract derives due/partial/paid from invoice amount and confirmed matching payments',
            disposition: 'proposal only; no update performed',
          });
        } else if (!target && ['issued', 'partially_paid'].includes(invoice.status)) {
          statusObservations[invoice.id || printable(invoice._id)] = 'amount unavailable/invalid; status mapping unresolved';
        }
      }
    }

    const nonEmptyCollections = Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));
    const report = {
      mode: 'dry-run/read-only',
      writesPerformed: false,
      clusterHost,
      database: databaseName,
      canonicalCodeContract: RULES,
      inventory: {
        collectionCount: collectionNames.length,
        totalDocuments: Object.values(counts).reduce((sum, count) => sum + count, 0),
        nonEmptyCollections,
        emptyCollectionCount: collectionNames.length - Object.keys(nonEmptyCollections).length,
        indexesByCollection: indexes,
      },
      branchRegistry,
      parentUserLinkReview: parentLinks,
      branchReferenceReview: branchReferences,
      statusProposals,
      statusObservations,
      missingUniqueIndexProposals: uniqueIndexProposals,
      demoRecords: demos,
      sourceNotes: [
        'No credential fields or values are projected or printed.',
        'Branch references are never rewritten because backend code does not define the canonical mapping to branches._id, branches.id, or branches.code.',
        'Parent user IDs are never created or reassigned automatically.',
        'Demo records are listed separately and excluded from proposed repairs.',
        'Index recommendations are descriptive only; this script never calls createIndex.',
      ],
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch(error => {
  const safeMessage = String(error?.message || error).replace(
    /mongodb(?:\+srv)?:\/\/[^\s]*/gi,
    'mongodb://[redacted]',
  );
  process.stderr.write(`${JSON.stringify({ mode: 'dry-run/read-only', error: safeMessage })}\n`);
  process.exitCode = 1;
});
