const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { closeDatabase, connectDatabase, getDatabase } = require('./database');

const DEMO_STUDENT_ID = 'DEMO-STUDENT-001';
const DEMO_PARENT_ID = 'DEMO-PARENT-001';
const DEMO_BRANCH_ID = 'DEMO-BRANCH-001';
const now = new Date();
const dueDate = new Date(now);
dueDate.setUTCDate(dueDate.getUTCDate() + 14);

const demoDocuments = [
  {
    collection: 'students',
    document: {
      _id: 'demo-student-001',
      id: DEMO_STUDENT_ID,
      name: 'Demo Student',
      fullName: 'Demo Student',
      grade: 'Demo Grade',
      section: 'A',
      classId: 'DEMO-CLASS-001',
      branchId: DEMO_BRANCH_ID,
      status: 'Active',
      demoRecord: true,
      createdAt: now,
    },
  },
  {
    collection: 'parents',
    document: {
      _id: 'demo-parent-001',
      id: DEMO_PARENT_ID,
      userId: DEMO_PARENT_ID,
      fullName: 'Demo Parent',
      studentIds: [DEMO_STUDENT_ID],
      demoRecord: true,
      createdAt: now,
    },
  },
  {
    collection: 'parentChildLinks',
    document: {
      _id: 'demo-parent-child-link-001',
      parentUserId: DEMO_PARENT_ID,
      studentId: DEMO_STUDENT_ID,
      status: 'verified',
      verified: true,
      revokedAt: null,
      demoRecord: true,
      createdAt: now,
    },
  },
  {
    collection: 'attendance',
    document: {
      _id: 'demo-attendance-001',
      id: 'DEMO-ATTENDANCE-001',
      studentId: DEMO_STUDENT_ID,
      date: now,
      status: 'Present',
      demoRecord: true,
      createdAt: now,
    },
  },
  {
    collection: 'timetable',
    document: {
      _id: 'demo-timetable-001',
      id: 'DEMO-TIMETABLE-001',
      studentId: DEMO_STUDENT_ID,
      classId: 'DEMO-CLASS-001',
      subject: 'Demo Mathematics',
      day: 'Monday',
      startTime: '09:00',
      endTime: '10:00',
      demoRecord: true,
      createdAt: now,
    },
  },
  {
    collection: 'homework',
    document: {
      _id: 'demo-homework-001',
      id: 'DEMO-HOMEWORK-001',
      studentId: DEMO_STUDENT_ID,
      title: 'Demo homework',
      subject: 'Demo Mathematics',
      description: 'Seed record for development display only.',
      dueDate,
      status: 'published',
      published: true,
      demoRecord: true,
      createdAt: now,
    },
  },
  {
    collection: 'submissions',
    document: {
      _id: 'demo-submission-001',
      id: 'DEMO-SUBMISSION-001',
      homeworkId: 'DEMO-HOMEWORK-001',
      studentId: DEMO_STUDENT_ID,
      status: 'submitted',
      submittedAt: now,
      fileName: 'demo-submission.pdf',
      demoRecord: true,
      createdAt: now,
    },
  },
  {
    collection: 'results',
    document: {
      _id: 'demo-result-001',
      id: 'DEMO-RESULT-001',
      studentId: DEMO_STUDENT_ID,
      examName: 'Demo assessment',
      subject: 'Demo Mathematics',
      score: 85,
      grade: 'B',
      status: 'published',
      published: true,
      demoRecord: true,
      createdAt: now,
    },
  },
  {
    collection: 'progress',
    document: {
      _id: 'demo-progress-001',
      id: 'DEMO-PROGRESS-001',
      studentId: DEMO_STUDENT_ID,
      subject: 'Demo Mathematics',
      progress: 85,
      status: 'published',
      published: true,
      demoRecord: true,
      createdAt: now,
    },
  },
  {
    collection: 'invoices',
    document: {
      _id: 'demo-invoice-001',
      id: 'DEMO-INVOICE-001',
      studentId: DEMO_STUDENT_ID,
      branchId: DEMO_BRANCH_ID,
      title: 'Demo tuition invoice',
      amount: 5000,
      currency: 'PKR',
      status: 'issued',
      dueDate,
      demoRecord: true,
      createdAt: now,
    },
  },
  {
    collection: 'payments',
    document: {
      _id: 'demo-payment-001',
      id: 'DEMO-PAYMENT-001',
      invoiceId: 'DEMO-INVOICE-001',
      studentId: DEMO_STUDENT_ID,
      branchId: DEMO_BRANCH_ID,
      amount: 1500,
      currency: 'PKR',
      method: 'cash',
      status: 'demo_record',
      demoRecord: true,
      createdAt: now,
    },
  },
];

async function main() {
  await connectDatabase();
  const db = getDatabase();
  const inserted = [];
  const skipped = [];

  for (const { collection, document } of demoDocuments) {
    const target = db.collection(collection);
    if (await target.findOne({ _id: document._id }, { projection: { _id: 1 } })) {
      skipped.push(collection);
      continue;
    }
    await target.insertOne(document);
    inserted.push(collection);
  }

  console.log(
    JSON.stringify({
      database: db.databaseName,
      inserted,
      skipped,
      demoRecordsOnly: true,
      authAccountsCreated: false,
    }),
  );
}

main()
  .catch(error => {
    console.error(`Demo seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
