const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ObjectId} = require('mongodb');
const {validateTemplate, validatePaper, shapeUrduTextForPdf, renderPaperPdf, createExamPaperRouter} = require('./examPapers');
const oid = () => new ObjectId();
const valid = () => ({title: 'Mathematics', durationMinutes: 60, totalMarks: 10, questions: [{text: 'Explain fractions.', marks: 10}], templateId: String(oid()), classId: String(oid()), sectionId: String(oid()), subjectId: String(oid())});
test('paper limits, exact marks, unknown scripts, SSRF logo URLs and template bounds are validated', () => {
  assert.equal(validatePaper(valid()).totalMarks, 10);
  assert.throws(() => validatePaper(null));
  assert.throws(() => validateTemplate(null));
  assert.throws(() => validatePaper({...valid(), questions: [null]}));
  for (const changes of [{questions: []}, {totalMarks: 11}, {durationMinutes: 0}, {classId: 'bad'}, {questions: [{text: 'x', marks: -1}]}, {title: 'اردو'}]) assert.throws(() => validatePaper({...valid(), ...changes}));
  // External logo URLs are rejected for SSRF prevention
  assert.throws(() => validateTemplate({name: 'SSRF Template', pageSize: 'A4', logoUrl: 'http://169.254.169.254/latest/meta-data'}));
  assert.throws(() => validatePaper({...valid(), imageUrl: 'https://evil.example/logo.png'}));
  // Urdu script succeeds when script: 'urdu' is explicitly requested
  const urduPaper = validatePaper({...valid(), script: 'urdu', title: 'اردو امتحان', questions: [{text: 'سوال نمبر ایک بیان کریں۔', marks: 10, type: 'short_answer', sectionTitle: 'حصہ اول'}]});
  assert.equal(urduPaper.script, 'urdu');
  assert.equal(validateTemplate({name: 'School A4', pageSize: 'A4'}).margin, 42);
  for (const change of [{pageSize: 'BAD'}, {margin: 4}, {header: 'x'.repeat(201)}]) assert.throws(() => validateTemplate({name: 'Test', pageSize: 'A4', ...change}));
});
function same(a, b) {return a != null && b != null && String(a) === String(b);}
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(q => matches(row, q));
    if (value === null) return row[key] == null;
    if (value && typeof value === 'object' && !(value instanceof ObjectId) && !(value instanceof Date)) {
      return Object.entries(value).every(([op, target]) => op === '$in' ? target.some(v => same(row[key], v)) : op === '$ne' ? row[key] !== target : op === '$lte' ? row[key] <= target : op === '$gt' ? row[key] > target : false);
    }
    return same(row[key], value);
  });
}
function fixture() {
  const school = {_id: oid(), name: 'Fixture School', isActive: true};
  const branch = {_id: oid(), schoolId: school._id, isActive: true};
  const cls = {_id: oid(), name: 'Grade 8', branchId: branch._id, isActive: true};
  const section = {_id: oid(), name: 'A', branchId: branch._id, classId: cls._id, isActive: true};
  const subject = {_id: oid(), name: 'Maths', branchId: branch._id, isActive: true};
  const data = {schools: [school], branches: [branch], schoolclasses: [cls], sections: [section], subjects: [subject], examPrintTemplates: [], examPapers: [], examQuestionBank: [], teacherassignments: []};
  const db = {collection(name) {const rows = data[name] || []; return {
    findOne: async query => rows.find(row => matches(row, query)) || null,
    insertOne: async row => {rows.push({...row}); return {insertedId: oid()};},
    updateOne: async (query, update) => {
      const row = rows.find(r => matches(r, query));
      if (!row) return {matchedCount: 0, modifiedCount: 0};
      if (update.$set) Object.assign(row, update.$set);
      return {matchedCount: 1, modifiedCount: 1};
    },
    find(query) {const found = rows.filter(row => matches(row, query));return {limit() {return this;}, sort() {return this;}, toArray: async () => found};},
  };}};
  const actor = {_id: oid(), id: 'fixture-admin', role: 'principal', schoolId: school._id, branchId: branch._id};
  const router = createExamPaperRouter({database: () => db});
  const request = (method, url, body, account = actor) => new Promise((resolve, reject) => {
    const req = {method, url, query: {}, headers: {}, body, user: {id: account.id, role: account.role}, authenticatedUserRecord: account};
    let status = 200;
    const res = {setHeader() {}, status(code) {status = code;return this;}, json(payload) {resolve({status, ...payload});return this;}};
    router.handle(req, res, error => error ? reject(error) : reject(new Error('Unmatched route')));
  });
  return {request, data, actor, school, branch, cls, section, subject};
}
test('school-scoped templates, question bank, draft->review->approval->publication workflow, and embedded Urdu PDF export work end-to-end', async () => {
  const f = fixture();
  const template = await f.request('POST', '/templates', {name: 'School default', pageSize: 'A4', header: 'Term examination'});
  assert.equal(template.status, 201);

  // Add item to reusable question bank
  const qbSaved = await f.request('POST', '/question-bank', {
    text: 'Which fraction is equivalent to 0.5?',
    marks: 5,
    type: 'mcq',
    options: ['1/4', '1/2', '3/4'],
    sectionTitle: 'Section A - Objective',
    classId: String(f.cls._id),
    sectionId: String(f.section._id),
    subjectId: String(f.subject._id),
  });
  assert.equal(qbSaved.status, 201);
  assert.equal((await f.request('GET', '/question-bank')).data.length, 1);

  const paper = await f.request('POST', '/', {...valid(), templateId: template.data.id, classId: String(f.cls._id), sectionId: String(f.section._id), subjectId: String(f.subject._id)});
  assert.equal(paper.status, 201);
  assert.equal(paper.data.schoolId, String(f.school._id));
  assert.equal(paper.data.status, 'draft');
  assert.equal((await f.request('GET', '/')).data.length, 1);

  // Cannot publish before approval
  assert.equal((await f.request('POST', `/${paper.data.id}/publish`, {})).status, 409);

  // Submit for review -> Approve -> Publish
  const inReview = await f.request('POST', `/${paper.data.id}/submit-review`, {});
  assert.equal(inReview.status, 200);
  assert.equal(inReview.data.status, 'in_review');

  const approved = await f.request('POST', `/${paper.data.id}/approve`, {decision: 'approved', reviewNotes: 'Verified against syllabus'});
  assert.equal(approved.status, 200);
  assert.equal(approved.data.status, 'approved');

  const published = await f.request('POST', `/${paper.data.id}/publish`, {});
  assert.equal(published.status, 200);
  assert.equal(published.data.status, 'published');

  const file = await f.request('GET', `/${paper.data.id}/pdf`);
  assert.equal(file.status, 200);
  assert.equal(Buffer.from(file.data.base64, 'base64').subarray(0, 4).toString(), '%PDF');

  // Verify Urdu contextual glyph shaping and visual RTL word ordering
  const shapedPhrase = shapeUrduTextForPdf('اردو امتحان');
  assert.notEqual(shapedPhrase, 'اردو امتحان');
  assert.match(shapedPhrase, /[\uFB50-\uFDFF\uFE70-\uFEFF]/);

  // Verify embedded Urdu font PDF rendering with Urdu headers, instructions, MCQs, signatures, and footer
  const urduPdf = await renderPaperPdf(
    {
      schoolName: 'گرین ووڈ اسکول',
      title: 'اردو سالانہ امتحان',
      instructions: 'تمام سوالات کے جوابات خوشخط تحریر کریں۔',
      script: 'urdu',
      className: 'جماعت ہشتم',
      sectionName: 'الف',
      subjectName: 'اردو',
      durationMinutes: 90,
      totalMarks: 10,
      questions: [
        {
          text: 'درج ذیل اشعار کی تشریح کریں۔',
          marks: 5,
          sectionTitle: 'حصہ انشائیہ',
        },
        {
          text: 'قومی شاعر کون ہیں؟',
          marks: 5,
          type: 'mcq',
          options: ['علامہ اقبال', 'غالب', 'میر تقی میر'],
          sectionTitle: 'حصہ معروضی',
        },
      ],
    },
    {
      pageSize: 'A4',
      margin: 42,
      script: 'urdu',
      header: 'سالانہ امتحان',
      footer: 'گرین ووڈ اسکول',
      signatures: {
        examinerLabel: 'ممتحن',
        hodLabel: 'صدر شعبہ',
        principalLabel: 'پرنسپل',
      },
    },
  );
  assert.equal(urduPdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(urduPdf.length > 2000);
  const rawPdfLatin1 = urduPdf.toString('latin1');
  assert.match(rawPdfLatin1, /NotoNaskhArabic/);
  assert.match(rawPdfLatin1, /\/FontFile2/);
  assert.match(rawPdfLatin1, /\/CIDFontType2/);
});
test('role, school, branch and template substitution cannot cross ownership', async () => {
  const f = fixture();
  assert.equal((await f.request('GET', '/templates', null, {...f.actor, role: 'parent'})).status, 403);
  assert.equal((await f.request('GET', '/templates', null, {...f.actor, schoolId: undefined})).status, 503);
  const foreign = {_id: oid(), name: 'Other School', isActive: true};f.data.schools.push(foreign);
  f.data.examPrintTemplates.push({id: String(oid()), schoolId: String(foreign._id), name: 'Foreign', pageSize: 'A4', margin: 42});
  assert.equal((await f.request('GET', '/templates')).data.length, 0);
  const body = {...valid(), templateId: f.data.examPrintTemplates[0].id, classId: String(f.cls._id), sectionId: String(f.section._id), subjectId: String(f.subject._id)};
  assert.equal((await f.request('POST', '/', body)).status, 404);
  assert.equal((await f.request('POST', '/', body, {...f.actor, branchId: oid()})).status, 404);
  assert.equal(f.data.examPapers.length, 0);
});
test('teachers must hold an active current assignment, including when opening old drafts', async () => {
  const f = fixture();const teacher = {...f.actor, id: 'fixture-teacher', role: 'teacher'};
  assert.equal((await f.request('POST', '/templates', {name: 'Denied', pageSize: 'A4'}, teacher)).status, 403);
  const template = await f.request('POST', '/templates', {name: 'A4', pageSize: 'A4'});
  const body = {...valid(), templateId: template.data.id, classId: String(f.cls._id), sectionId: String(f.section._id), subjectId: String(f.subject._id)};
  assert.equal((await f.request('POST', '/', body, teacher)).status, 403);
  const assignment = {teacherId: teacher._id, branchId: f.branch._id, classId: f.cls._id, sectionId: f.section._id, subjectId: f.subject._id, isActive: true, validFrom: new Date(Date.now() - 1000)};f.data.teacherassignments.push(assignment);
  const paper = await f.request('POST', '/', body, teacher);assert.equal(paper.status, 201);
  assignment.isActive = false;
  assert.equal((await f.request('GET', '/', null, teacher)).data.length, 0);
  assert.equal((await f.request('GET', `/${paper.data.id}/pdf`, null, teacher)).status, 403);
});
test('long papers generate multiple PDF pages with bounded template settings', async () => {
  const pdf = await renderPaperPdf({schoolName: 'School', title: 'Long paper', className: 'Class', sectionName: 'A', subjectName: 'Science', durationMinutes: 120, totalMarks: 100, questions: Array.from({length: 100}, () => ({text: 'Explain the experiment and support your answer with an example. '.repeat(10), marks: 1}))}, {pageSize: 'A4', margin: 42, footer: 'School examination'});
  assert.ok(pdf.length > 1000);
  const source = pdf.toString('latin1');
  const count = /\/Type \/Pages\s*\/Count (\d+)/.exec(source);
  assert.ok(count && Number(count[1]) > 1);
});
