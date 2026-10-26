// Fictional, development-only UI preview records. Never sent to an API.
export const parentReferenceNotifications = [
  { id: 'PREVIEW-PARENT-DLP', title: 'Teacher DLP received', body: 'Miss Ayesha · Class 6-A · Fractions in daily life', previewDlpVersion: { id: 'PREVIEW-DLP-V1', version: 1, className: '6-A', title: 'Fractions in daily life', content: 'We practised adding fractions with everyday examples. Homework: Exercise 4.2, questions 1–4.' } },
  { id: 'PREVIEW-PARENT-HW1', title: 'Homework assigned', body: 'Ahmed Khan · Fractions', needsAction: true },
  { id: 'PREVIEW-PARENT-HW2', title: 'Homework assigned', body: 'Sara Khan · Reading practice', needsAction: true },
  { id: 'PREVIEW-PARENT-FB1', title: 'Teacher feedback published', body: 'Ahmed Khan · September 2026' },
  { id: 'PREVIEW-PARENT-FB2', title: 'Teacher feedback published', body: 'Sara Khan · September 2026' },
  { id: 'PREVIEW-PARENT-E1', title: 'School event · Science Fair', body: '2026-10-15 · Academic' },
  { id: 'PREVIEW-PARENT-E2', title: 'School event · Parent–Teacher Meetings', body: '2026-10-07 · PTM' },
  { id: 'PREVIEW-PARENT-E3', title: 'School event · Sports Day', body: '2026-10-22 · Sports' },
  { id: 'PREVIEW-PARENT-E4', title: 'School event · Autumn break', body: '2026-10-26 · Holiday' },
];
export const previewNotifications = [
  {
    id: 'PREVIEW-NOTICE-01',
    title: 'Welcome to the preview',
    body: 'This notification is local UI sample content only.',
    createdAt: '2026-10-02T08:00:00.000Z',
  },
];

export const studentPreview = {
  profile: {
    id: 'PREVIEW-STU-01',
    fullName: 'Amina Khan',
    grade: 'Grade 8',
    section: 'A',
  },
  timetable: [
    {
      id: 'PREVIEW-TT-01',
      day: 'Monday',
      startTime: '08:00',
      endTime: '08:45',
      subject: 'Mathematics',
      teacher: 'Sample teacher',
      room: 'Room 08',
    },
    {
      id: 'PREVIEW-TT-02',
      day: 'Monday',
      startTime: '09:00',
      endTime: '09:45',
      subject: 'Science',
      teacher: 'Sample teacher',
      room: 'Lab 02',
    },
  ],
  attendance: [
    {
      id: 'PREVIEW-ATT-01',
      date: '2026-10-01',
      subject: 'School day',
      status: 'Present',
    },
  ],
  results: [
    {
      id: 'PREVIEW-RES-01',
      examName: 'Term assessment',
      subject: 'Mathematics',
      score: '88/100',
      grade: 'A',
      teacherFeedback: 'Fictional sample feedback.',
    },
  ],
  progress: [
    {
      id: 'PREVIEW-PROG-01',
      subject: 'Reading',
      progress: 76,
      feedback: 'Fictional sample progress note.',
    },
  ],
  homework: [
    {
      id: 'PREVIEW-HW-01',
      title: 'Fractions practice',
      subject: 'Mathematics',
      description: 'Complete practice questions 1–5.',
      dueDate: '2026-10-08',
      latestSubmission: { status: 'Not submitted' },
    },
  ],
  fees: [
    {
      id: 'PREVIEW-FEE-01',
      invoiceNumber: 'DEMO-2026-01',
      description: 'October tuition',
      amount: 12000,
      currency: 'PKR',
      dueDate: '2026-10-25',
      status: 'partially_paid',
      confirmedPaidAmount: 4000,
      pendingAmount: 1000,
      balanceDue: 8000,
      availableBalance: 7000,
    },
  ],
  applications: [],
};

export const parentPreview = {
  children: [
    {
      id: 'PREVIEW-CHILD-01',
      grNumber: '1042',
      fullName: 'Ahmed Khan',
      name: 'Ahmed Khan',
      grade: 'Grade 6',
      section: 'A',
      attendance: '94%',
      latestResult: '82%',
      status: 'Preview',
    },
    {
      id: 'PREVIEW-CHILD-02',
      fullName: 'Sara Khan',
      name: 'Sara Khan',
      grade: 'Grade 4',
      section: 'B',
      attendance: '96%',
      latestResult: '88%',
      status: 'Preview',
    },
  ],
  records: {
    'PREVIEW-CHILD-01': {
      profile: {
        ...studentPreview.profile,
        id: 'PREVIEW-CHILD-01',
        grNumber: '1042',
        fullName: 'Ahmed Khan',
        grade: 'Grade 6',
      },
      attendance: studentPreview.attendance,
      timetable: studentPreview.timetable,
      homework: studentPreview.homework,
      results: [
        {
          ...studentPreview.results[0],
          score: '82/100',
          examName: 'Published mid-term',
        },
      ],
      fees: [
        {
          id: 'PREVIEW-FEE-01',
          description: 'September voucher',
          amount: 5250,
          currency: 'PKR',
          dueDate: '2026-10-10',
          status: 'Due',
        },
      ],
      feedback: {
        homework: [],
        results: studentPreview.results,
        progress: [
          {
            id: 'PREVIEW-BEHAVIOUR-01',
            category: 'personal',
            area: 'Behaviour',
            status: 'Published',
            feedback: 'Reviewed teacher observations',
            period: 'September 2026',
          },
          ...studentPreview.progress,
        ],
      },
      applications: [],
    },
    'PREVIEW-CHILD-02': {
      profile: {
        id: 'PREVIEW-CHILD-02',
        fullName: 'Sara Khan',
        grade: 'Grade 4',
        section: 'B',
      },
      attendance: [
        {
          id: 'PREVIEW-ATT-02',
          date: '2026-10-01',
          subject: 'School day',
          status: 'Present',
        },
      ],
      timetable: [
        {
          id: 'PREVIEW-TT-03',
          day: 'Monday',
          startTime: '08:00',
          endTime: '08:45',
          subject: 'English',
          teacher: 'Sample teacher',
          room: 'Room 05',
        },
      ],
      homework: [],
      results: [],
      fees: [],
      feedback: { homework: [], results: [], progress: [] },
      applications: [],
    },
  },
};

export const financePreview = {
  summary: { collected: 245000, outstanding: 68000, currency: 'PKR' },
  invoices: [
    {
      id: 'PREVIEW-INV-01',
      student: 'Amina Khan',
      studentId: 'PREVIEW-STU-01',
      description: 'October tuition',
      amount: 12000,
      dueDate: '2026-10-10',
      status: 'Partially paid',
      voucherCode: 'PREVIEW-VOUCHER-01',
    },
  ],
  dues: [
    {
      id: 'PREVIEW-INV-01',
      student: 'Amina Khan',
      studentId: 'PREVIEW-STU-01',
      paidAmount: 4000,
      pendingAmount: 1000,
      balanceDue: 8000,
      availableBalance: 7000,
      dueDate: '2026-10-10',
      status: 'Due',
      currency: 'PKR',
    },
  ],
  pendingPayments: [
    {
      _id: 'PREVIEW-PAY-01',
      invoiceId: 'PREVIEW-INV-01',
      amount: 1000,
      currency: 'PKR',
      method: 'bank transfer',
      status: 'Pending verification',
    },
  ],
  paymentHistory: [],
  receipts: [],
  report: {
    confirmedCollections: [{ _id: 'PKR', total: 245000, count: 28 }],
    byMethod: [{ _id: 'Bank transfer', total: 120000, count: 12 }],
  },
};
