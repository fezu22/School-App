const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('./database');

const URDU_FONT_PATH = path.resolve(__dirname, 'assets', 'fonts', 'noto_naskh_arabic.ttf');
const QUESTION_TYPES = new Set(['descriptive', 'short_answer', 'long_answer', 'mcq', 'true_false']);
const MAX_LOGO_BYTES = 256 * 1024;

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function id(value) {
  if (value instanceof ObjectId) return value;
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    invalid('A valid record ID is required.');
  }
  return new ObjectId(value);
}

function assertNoExternalUrl(body) {
  for (const key of ['logoUrl', 'imageUrl', 'headerLogoUrl', 'schoolLogoUrl', 'logo']) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
      invalid(
        'External logo or image URLs are not permitted (SSRF protection). Provide a validated base64 PNG/JPEG logo instead.',
        400,
      );
    }
  }
}

function validateLogoBase64(rawLogo) {
  if (rawLogo === undefined || rawLogo === null || rawLogo === '') return null;
  if (typeof rawLogo !== 'string') invalid('Logo must be a base64-encoded PNG or JPEG string.');
  if (/^(https?|ftp|file|data:text):/i.test(rawLogo.trim())) {
    invalid('External logo URLs are not permitted (SSRF protection).');
  }
  const stripped = rawLogo.trim().replace(/^data:image\/(png|jpeg|jpg);base64,/i, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(stripped)) {
    invalid('Logo must be valid base64 data.');
  }
  const buf = Buffer.from(stripped, 'base64');
  if (buf.length < 8 || buf.length > MAX_LOGO_BYTES) {
    invalid('Logo image must be between 8 bytes and 256 KB.');
  }
  const isPng = buf
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!isPng && !isJpeg) {
    invalid('Logo must be a valid PNG or JPEG binary.');
  }
  return stripped;
}

function text(value, label, limit, optional = false, allowUrdu = false) {
  if (optional && (value == null || value === '')) return '';
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > limit ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)
  ) {
    invalid(`${label} is missing or too long.`);
  }
  if (!allowUrdu) {
    // Built-in PDF fonts support Latin text. Require explicit script: 'urdu' for embedded Urdu/RTL font.
    if (/[^\x20-\x7E\n\r\t\u00A0-\u00FF]/.test(value)) {
      invalid(
        `${label}: this version supports Latin text only; an embedded font is required for other scripts.`,
      );
    }
  } else {
    // Allow Latin + Urdu/Arabic Unicode blocks when embedded font is enabled
    if (
      /[^\x20-\x7E\n\r\t\u00A0-\u00FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u2000-\u206F]/.test(
        value,
      )
    ) {
      invalid(`${label} contains unsupported script characters.`);
    }
  }
  return value.trim();
}

function validateTemplate(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('Provide a template object.');
  }
  assertNoExternalUrl(body);
  const margin = Number(body.margin ?? 42);
  if (!['A4', 'LETTER'].includes(body.pageSize) || !Number.isInteger(margin) || margin < 24 || margin > 72) {
    invalid('Choose A4/LETTER and a margin between 24 and 72 points.');
  }
  const script = body.script === 'urdu' ? 'urdu' : 'latin';
  const allowUrdu = script === 'urdu';
  const logoBase64 = validateLogoBase64(body.logoBase64);
  const signatures =
    body.signatures && typeof body.signatures === 'object' && !Array.isArray(body.signatures)
      ? {
          examinerLabel: text(body.signatures.examinerLabel || 'Prepared By (Teacher)', 'Examiner label', 80, true, allowUrdu),
          hodLabel: text(body.signatures.hodLabel || 'Reviewed By (HOD)', 'HOD label', 80, true, allowUrdu),
          principalLabel: text(body.signatures.principalLabel || 'Approved By (Principal)', 'Principal label', 80, true, allowUrdu),
        }
      : {
          examinerLabel: 'Prepared By (Teacher)',
          hodLabel: 'Reviewed By (HOD)',
          principalLabel: 'Approved By (Principal)',
        };

  return {
    name: text(body.name, 'Template name', 80, false, allowUrdu),
    pageSize: body.pageSize,
    margin,
    script,
    header: text(body.header, 'Header', 200, true, allowUrdu),
    footer: text(body.footer, 'Footer', 200, true, allowUrdu),
    ...(logoBase64 ? { logoBase64 } : {}),
    signatures,
  };
}

function validateQuestionItem(question, allowUrdu = false) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) {
    invalid('Each question must be an object.');
  }
  const marks = Number(question.marks);
  if (!Number.isInteger(marks) || marks < 1 || marks > 100) {
    invalid('Each question requires 1–100 marks.');
  }
  const qType = question.type ? String(question.type) : 'descriptive';
  if (!QUESTION_TYPES.has(qType)) {
    invalid('Question type must be descriptive, short_answer, long_answer, mcq, or true_false.');
  }
  const sectionTitle = text(question.sectionTitle || question.examSection, 'Section title', 120, true, allowUrdu);
  let options = [];
  if (qType === 'mcq') {
    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 6) {
      invalid('MCQ questions require 2–6 options.');
    }
    options = question.options.map((opt, idx) =>
      text(opt, `MCQ option ${idx + 1}`, 300, false, allowUrdu),
    );
  } else if (qType === 'true_false') {
    options = ['True', 'False'];
  }
  return {
    text: text(question.text, 'Question', 4000, false, allowUrdu),
    marks,
    type: qType,
    ...(sectionTitle ? { sectionTitle } : {}),
    ...(options.length > 0 ? { options } : {}),
  };
}

function validatePaper(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('Provide a paper object.');
  }
  assertNoExternalUrl(body);
  const script = body.script === 'urdu' ? 'urdu' : 'latin';
  const allowUrdu = script === 'urdu';
  const durationMinutes = Number(body.durationMinutes);
  const totalMarks = Number(body.totalMarks);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 360) {
    invalid('Duration must be 5–360 minutes.');
  }
  if (!Number.isInteger(totalMarks) || totalMarks < 1 || totalMarks > 1000) {
    invalid('Total marks must be 1–1000.');
  }
  if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 100) {
    invalid('Provide 1–100 questions.');
  }
  const questions = body.questions.map(q => validateQuestionItem(q, allowUrdu));
  if (questions.reduce((sum, q) => sum + q.marks, 0) !== totalMarks) {
    invalid('Question marks must equal total marks.');
  }
  return {
    title: text(body.title, 'Paper title', 150, false, allowUrdu),
    instructions: text(body.instructions, 'Instructions', 2000, true, allowUrdu),
    script,
    durationMinutes,
    totalMarks,
    questions,
    templateId: String(id(body.templateId)),
    classId: String(id(body.classId)),
    sectionId: String(id(body.sectionId)),
    subjectId: String(id(body.subjectId)),
  };
}

// Contextual Arabic/Urdu presentation forms [isolated, final, initial, medial]
// Letters with 2 entries [isolated, final] are right-joining only (non-connectors to the left).
const URDU_PRESENTATION_FORMS = {
  '\u0621': ['\uFE80'],
  '\u0622': ['\uFE81', '\uFE82'],
  '\u0623': ['\uFE83', '\uFE84'],
  '\u0624': ['\uFE85', '\uFE86'],
  '\u0625': ['\uFE87', '\uFE88'],
  '\u0626': ['\uFE89', '\uFE8A', '\uFE8B', '\uFE8C'],
  '\u0627': ['\uFE8D', '\uFE8E'],
  '\u0628': ['\uFE8F', '\uFE90', '\uFE91', '\uFE92'],
  '\u067E': ['\uFB56', '\uFB57', '\uFB58', '\uFB59'], // پ Pe
  '\u062A': ['\uFE95', '\uFE96', '\uFE97', '\uFE98'],
  '\u0679': ['\uFB66', '\uFB67', '\uFB68', '\uFB69'], // ٹ Tte
  '\u062B': ['\uFE99', '\uFE9A', '\uFE9B', '\uFE9C'],
  '\u062C': ['\uFE9D', '\uFE9E', '\uFE9F', '\uFEA0'],
  '\u0686': ['\uFB7A', '\uFB7B', '\uFB7C', '\uFB7D'], // چ Tcheh
  '\u062D': ['\uFEA1', '\uFEA2', '\uFEA3', '\uFEA4'],
  '\u062E': ['\uFEA5', '\uFEA6', '\uFEA7', '\uFEA8'],
  '\u062F': ['\uFEA9', '\uFEAA'],
  '\u0688': ['\uFB88', '\uFB89'], // ڈ Ddal
  '\u0630': ['\uFEAB', '\uFEAC'],
  '\u0631': ['\uFEAD', '\uFEAE'],
  '\u0691': ['\uFB8C', '\uFB8D'], // ڑ Rreh
  '\u0632': ['\uFEAF', '\uFEB0'],
  '\u0698': ['\uFB8A', '\uFB8B'], // ژ Jeh
  '\u0633': ['\uFEB1', '\uFEB2', '\uFEB3', '\uFEB4'],
  '\u0634': ['\uFEB5', '\uFEB6', '\uFEB7', '\uFEB8'],
  '\u0635': ['\uFEB9', '\uFEBA', '\uFEBB', '\uFEBC'],
  '\u0636': ['\uFEBD', '\uFEBE', '\uFEBF', '\uFEC0'],
  '\u0637': ['\uFEC1', '\uFEC2', '\uFEC3', '\uFEC4'],
  '\u0638': ['\uFEC5', '\uFEC6', '\uFEC7', '\uFEC8'],
  '\u0639': ['\uFEC9', '\uFECA', '\uFECB', '\uFECC'],
  '\u063A': ['\uFECD', '\uFECE', '\uFECF', '\uFED0'],
  '\u0641': ['\uFED1', '\uFED2', '\uFED3', '\uFED4'],
  '\u0642': ['\uFED5', '\uFED6', '\uFED7', '\uFED8'],
  '\u06A9': ['\uFB8E', '\uFB8F', '\uFB90', '\uFB91'], // ک Keheh
  '\u0643': ['\uFED9', '\uFEDA', '\uFEDB', '\uFEDC'],
  '\u06AF': ['\uFB92', '\uFB93', '\uFB94', '\uFB95'], // گ Gaf
  '\u0644': ['\uFEDD', '\uFEDE', '\uFEDF', '\uFEE0'],
  '\u0645': ['\uFEE1', '\uFEE2', '\uFEE3', '\uFEE4'],
  '\u0646': ['\uFEE5', '\uFEE6', '\uFEE7', '\uFEE8'],
  '\u06BA': ['\uFB9E', '\uFB9F'], // ں Noon Ghunna
  '\u0648': ['\uFEED', '\uFEEE'],
  '\u0647': ['\uFEE9', '\uFEEA', '\uFEEB', '\uFEEC'],
  '\u06C1': ['\uFBA6', '\uFBA7', '\uFBA8', '\uFBA9'], // ہ Heh Goal
  '\u06BE': ['\uFBAA', '\uFBAB', '\uFBAC', '\uFBAD'], // ھ Heh Doachashmee
  '\u0629': ['\uFE93', '\uFE94'],
  '\u06CC': ['\uFBFC', '\uFBFD', '\uFBFE', '\uFBFF'], // ی Farsi Yeh
  '\u064A': ['\uFEF1', '\uFEF2', '\uFEF3', '\uFEF4'],
  '\u0649': ['\uFEEF', '\uFEF0'],
  '\u06D2': ['\uFBAE', '\uFBAF'], // ے Yeh Barree
};

const LAM_ALEF_LIGATURES = {
  '\u0622': ['\uFEF5', '\uFEF6'],
  '\u0623': ['\uFEF7', '\uFEF8'],
  '\u0625': ['\uFEF9', '\uFEFA'],
  '\u0627': ['\uFEFB', '\uFEFC'],
};

const URDU_RTL_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

function canConnectLeft(ch) {
  const forms = URDU_PRESENTATION_FORMS[ch];
  return Boolean(forms && forms.length === 4);
}

function canConnectRight(ch) {
  const forms = URDU_PRESENTATION_FORMS[ch];
  return Boolean(forms && forms.length >= 2);
}

function shapeUrduWord(word) {
  if (!URDU_RTL_CHAR_RE.test(word)) return word;
  const chars = Array.from(word);
  const shaped = [];
  for (let i = 0; i < chars.length; i += 1) {
    const curr = chars[i];
    const prev = i > 0 ? chars[i - 1] : null;
    const next = i + 1 < chars.length ? chars[i + 1] : null;
    const prevConnects = Boolean(prev && canConnectLeft(prev));

    if (curr === '\u0644' && next && LAM_ALEF_LIGATURES[next]) {
      const ligature = LAM_ALEF_LIGATURES[next];
      shaped.push(prevConnects ? ligature[1] : ligature[0]);
      i += 1;
      continue;
    }

    const forms = URDU_PRESENTATION_FORMS[curr];
    if (!forms) {
      shaped.push(curr);
      continue;
    }
    const nextConnects = Boolean(next && canConnectRight(next) && canConnectLeft(curr));
    if (prevConnects && nextConnects && forms.length === 4) {
      shaped.push(forms[3]); // medial
    } else if (prevConnects && forms.length >= 2) {
      shaped.push(forms[1]); // final
    } else if (nextConnects && forms.length === 4) {
      shaped.push(forms[2]); // initial
    } else {
      shaped.push(forms[0]); // isolated
    }
  }
  return shaped.reverse().join('');
}

function shapeUrduTextForPdf(value, enabled = true) {
  const raw = String(value ?? '');
  if (!enabled || !URDU_RTL_CHAR_RE.test(raw)) return raw;
  return raw
    .split('\n')
    .map(line => {
      if (!URDU_RTL_CHAR_RE.test(line)) return line;
      const tokens = line.split(/(\s+)/);
      const shapedTokens = tokens.map(token => (URDU_RTL_CHAR_RE.test(token) ? shapeUrduWord(token) : token));
      return shapedTokens.reverse().join('');
    })
    .join('\n');
}

async function renderPaperPdf(paper, template) {
  const PDFDocument = require('pdfkit');
  const isUrduScript = paper.script === 'urdu' || template.script === 'urdu';
  const useUrduFont = isUrduScript && fs.existsSync(URDU_FONT_PATH);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: template.pageSize,
      margins: {
        top: template.margin,
        bottom: template.margin + 24,
        left: template.margin,
        right: template.margin,
      },
      bufferPages: true,
    });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    if (useUrduFont) {
      doc.registerFont('UrduEmbedded', URDU_FONT_PATH);
    }
    const primaryFont = useUrduFont ? 'UrduEmbedded' : 'Helvetica';
    const boldFont = useUrduFont ? 'UrduEmbedded' : 'Helvetica-Bold';
    const textAlign = isUrduScript ? 'right' : 'left';
    const shape = val => shapeUrduTextForPdf(val, useUrduFont);

    if (template.logoBase64) {
      try {
        const logoBuf = Buffer.from(template.logoBase64, 'base64');
        doc.image(logoBuf, doc.page.width / 2 - 24, template.margin, { width: 48 });
        doc.moveDown(3);
      } catch {
        // Proceed with text header if image decoder encounters minimal synthetic test buffer
      }
    }

    doc.font(boldFont).fontSize(17).text(shape(paper.schoolName || 'School'), { align: 'center' });
    if (template.header) {
      doc.font(primaryFont).fontSize(10).text(shape(template.header), { align: 'center' });
    }
    doc.moveDown().font(boldFont).fontSize(14).text(shape(paper.title), { align: 'center' });
    doc
      .moveDown()
      .font(primaryFont)
      .fontSize(10)
      .text(shape(`${paper.className} / ${paper.sectionName}  |  ${paper.subjectName}`), { align: textAlign });
    doc.text(`Duration: ${paper.durationMinutes} minutes     Total marks: ${paper.totalMarks}`, {
      align: textAlign,
    });
    doc
      .moveDown()
      .font(primaryFont)
      .text('Student name: _________________________   Roll no: ______________', { align: textAlign });
    if (paper.instructions) {
      doc.moveDown().font(primaryFont).text(shape(paper.instructions), { align: textAlign });
    }

    let currentSectionTitle = '';
    paper.questions.forEach((question, index) => {
      if (question.sectionTitle && question.sectionTitle !== currentSectionTitle) {
        currentSectionTitle = question.sectionTitle;
        doc.moveDown();
        doc.font(boldFont).fontSize(12).text(shape(currentSectionTitle), { align: textAlign });
      }
      const value = `${index + 1}. ${shape(question.text)}  [${question.marks} marks]`;
      doc.moveDown();
      if (doc.y + Math.min(doc.heightOfString(value), 120) > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }
      doc.font(primaryFont).fontSize(11).text(value, { align: textAlign });
      if (Array.isArray(question.options) && question.options.length > 0) {
        const optionLine = question.options
          .map((opt, idx) => `(${String.fromCharCode(65 + idx)}) ${shape(opt)}`)
          .join('    ');
        doc.font(primaryFont).fontSize(10).text(`   ${optionLine}`, { align: textAlign });
      }
    });

    const sigs = template.signatures || {
      examinerLabel: 'Prepared By (Teacher)',
      hodLabel: 'Reviewed By (HOD)',
      principalLabel: 'Approved By (Principal)',
    };
    doc.moveDown(2);
    if (doc.y + 45 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    doc
      .font(primaryFont)
      .fontSize(9)
      .text(
        `${shape(sigs.examinerLabel)}: _______________   ${shape(sigs.hodLabel)}: _______________   ${shape(sigs.principalLabel)}: _______________`,
        { align: 'center' },
      );

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font(primaryFont)
        .fontSize(8)
        .text(
          `${shape(template.footer || '')}     Page ${i + 1} of ${range.count}`,
          template.margin,
          doc.page.height - template.margin,
          { width: doc.page.width - 2 * template.margin, align: 'center', lineBreak: false },
        );
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

function createExamPaperRouter({ database = getDatabase, render = renderPaperPdf } = {}) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      if (!req.user) invalid('Authentication is required.', 401);
      if (!['teacher', 'principal', 'super_admin'].includes(req.user.role)) {
        invalid('Academic staff access is required.', 403);
      }
      const actor = req.authenticatedUserRecord;
      if (!actor?.schoolId) {
        invalid('The account needs a verified school mapping before paper access.', 503);
      }
      const db = database();
      const school = await db.collection('schools').findOne({ _id: id(actor.schoolId) });
      if (!school || school.active === false || school.isActive === false || school.status === 'suspended') {
        invalid('School access is unavailable.', 403);
      }
      req.paperScope = { schoolId: String(school._id) };
      req.paperSchool = school;
      next();
    } catch (error) {
      next(error);
    }
  });

  async function branchFor(req, branchId) {
    const actor = req.authenticatedUserRecord;
    const branch = await database().collection('branches').findOne({ _id: id(branchId) });
    if (!branch || String(branch.schoolId) !== req.paperScope.schoolId || branch.isActive === false) {
      invalid('Branch not found.', 404);
    }
    if (req.user.role !== 'super_admin' && String(actor.branchId) !== String(branch._id)) {
      invalid('Branch not found.', 404);
    }
    return branch;
  }

  async function academicScope(req, fields, branchId) {
    await branchFor(req, branchId);
    const db = database();
    const branch = id(branchId);
    const cls = await db.collection('schoolclasses').findOne({
      _id: id(fields.classId),
      branchId: branch,
      isActive: true,
    });
    const section = await db.collection('sections').findOne({
      _id: id(fields.sectionId),
      branchId: branch,
      classId: id(fields.classId),
      isActive: true,
    });
    const subject = await db.collection('subjects').findOne({
      _id: id(fields.subjectId),
      branchId: branch,
      isActive: true,
    });
    if (!cls || !section || !subject) {
      invalid('Academic records are unavailable for this branch.', 404);
    }
    if (req.user.role === 'teacher') {
      const now = new Date();
      const assignment = await db.collection('teacherassignments').findOne({
        teacherId: id(req.authenticatedUserRecord._id),
        branchId: branch,
        classId: cls._id,
        sectionId: section._id,
        subjectId: subject._id,
        isActive: true,
        revokedAt: null,
        validFrom: { $lte: now },
        $or: [{ validUntil: null }, { validUntil: { $gt: now } }],
      });
      if (!assignment) invalid('Current teacher assignment is required.', 403);
    }
    return { className: cls.name, sectionName: section.name, subjectName: subject.name };
  }

  const handle = action => async (req, res, next) => {
    try {
      await action(req, res);
    } catch (error) {
      next(error);
    }
  };

  router.get(
    '/catalog',
    handle(async (req, res) => {
      const db = database();
      const branches = await db
        .collection('branches')
        .find(
          {
            $or: [{ schoolId: req.paperScope.schoolId }, { schoolId: id(req.paperScope.schoolId) }],
            ...(req.user.role !== 'super_admin' ? { _id: id(req.authenticatedUserRecord.branchId) } : {}),
            isActive: { $ne: false },
          },
          { projection: { _id: 1, name: 1 } },
        )
        .limit(100)
        .toArray();
      const branchIds = branches.map(row => row._id);
      const filter = { branchId: { $in: branchIds }, isActive: true };
      const [classes, sections, subjects] = await Promise.all(
        ['schoolclasses', 'sections', 'subjects'].map(name =>
          db
            .collection(name)
            .find(filter, { projection: { _id: 1, name: 1, branchId: 1, classId: 1 } })
            .limit(1000)
            .toArray(),
        ),
      );
      let allowedClasses = classes;
      let allowedSections = sections;
      let allowedSubjects = subjects;
      if (req.user.role === 'teacher') {
        const now = new Date();
        const assignments = await db
          .collection('teacherassignments')
          .find({
            teacherId: id(req.authenticatedUserRecord._id),
            branchId: { $in: branchIds },
            isActive: true,
            revokedAt: null,
            validFrom: { $lte: now },
            $or: [{ validUntil: null }, { validUntil: { $gt: now } }],
          })
          .limit(1000)
          .toArray();
        const includes = (key, row) => assignments.some(a => String(a[key]) === String(row._id));
        allowedClasses = classes.filter(row => includes('classId', row));
        allowedSections = sections.filter(row => includes('sectionId', row));
        allowedSubjects = subjects.filter(row => includes('subjectId', row));
      }
      res.json({
        success: true,
        data: { branches, classes: allowedClasses, sections: allowedSections, subjects: allowedSubjects },
      });
    }),
  );

  router.get(
    '/templates',
    handle(async (req, res) =>
      res.json({
        success: true,
        data: await database()
          .collection('examPrintTemplates')
          .find(req.paperScope, { projection: { _id: 0 } })
          .limit(100)
          .toArray(),
      }),
    ),
  );

  router.post(
    '/templates',
    handle(async (req, res) => {
      if (req.user.role === 'teacher') invalid('School administrators manage templates.', 403);
      const record = {
        ...validateTemplate(req.body),
        ...req.paperScope,
        id: crypto.randomBytes(12).toString('hex'),
        createdBy: req.user.id,
        createdAt: new Date(),
      };
      await database().collection('examPrintTemplates').insertOne(record);
      res.status(201).json({ success: true, data: record });
    }),
  );

  // Reusable Question Bank endpoints
  router.get(
    '/question-bank',
    handle(async (req, res) => {
      const filter = {
        ...req.paperScope,
        ...(req.user.role !== 'super_admin' ? { branchId: String(req.authenticatedUserRecord.branchId) } : {}),
        ...(typeof req.query?.classId === 'string' && req.query.classId ? { classId: req.query.classId } : {}),
        ...(typeof req.query?.subjectId === 'string' && req.query.subjectId ? { subjectId: req.query.subjectId } : {}),
      };
      const items = await database()
        .collection('examQuestionBank')
        .find(filter, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(200)
        .toArray();
      res.json({ success: true, data: items });
    }),
  );

  router.post(
    '/question-bank',
    handle(async (req, res) => {
      const allowUrdu = req.body?.script === 'urdu';
      const item = validateQuestionItem(req.body, allowUrdu);
      const branchId = String(
        id(req.user.role === 'super_admin' ? req.body.branchId : req.authenticatedUserRecord.branchId),
      );
      const classId = String(id(req.body?.classId));
      const sectionId = String(id(req.body?.sectionId));
      const subjectId = String(id(req.body?.subjectId));
      const names = await academicScope(req, { classId, sectionId, subjectId }, branchId);
      const record = {
        ...item,
        ...names,
        ...req.paperScope,
        branchId,
        classId,
        sectionId,
        subjectId,
        script: allowUrdu ? 'urdu' : 'latin',
        id: crypto.randomBytes(12).toString('hex'),
        createdBy: req.user.id,
        createdAt: new Date(),
      };
      await database().collection('examQuestionBank').insertOne(record);
      res.status(201).json({ success: true, data: record });
    }),
  );

  router.get(
    '/',
    handle(async (req, res) => {
      const filter = {
        ...req.paperScope,
        ...(req.user.role !== 'super_admin' ? { branchId: String(req.authenticatedUserRecord.branchId) } : {}),
        ...(req.user.role === 'teacher' ? { createdBy: req.user.id } : {}),
      };
      const papers = await database()
        .collection('examPapers')
        .find(filter, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      const accessible = [];
      for (const paper of papers) {
        try {
          await academicScope(req, paper, paper.branchId);
          accessible.push(paper);
        } catch (error) {
          if (![403, 404].includes(error.status)) throw error;
        }
      }
      res.json({ success: true, data: accessible });
    }),
  );

  router.post(
    '/',
    handle(async (req, res) => {
      const fields = validatePaper(req.body);
      const branchId = String(
        id(req.user.role === 'super_admin' ? req.body.branchId : req.authenticatedUserRecord.branchId),
      );
      const names = await academicScope(req, fields, branchId);
      const template = await database()
        .collection('examPrintTemplates')
        .findOne({ ...req.paperScope, id: fields.templateId });
      if (!template) invalid('Template not found.', 404);
      const record = {
        ...fields,
        ...names,
        ...req.paperScope,
        branchId,
        schoolName: text(req.paperSchool.name, 'School name', 150, false, fields.script === 'urdu'),
        id: crypto.randomBytes(12).toString('hex'),
        status: 'draft',
        createdBy: req.user.id,
        createdAt: new Date(),
        templateSnapshot: { ...validateTemplate(template) },
      };
      await database().collection('examPapers').insertOne(record);
      res.status(201).json({ success: true, data: record });
    }),
  );

  // Draft -> Review -> Approval -> Publication workflow transitions
  router.post(
    '/:id/submit-review',
    handle(async (req, res) => {
      const db = database();
      const paperId = String(id(req.params.id));
      const paper = await db.collection('examPapers').findOne({
        ...req.paperScope,
        id: paperId,
        ...(req.user.role === 'teacher' ? { createdBy: req.user.id } : {}),
      });
      if (!paper) invalid('Paper not found.', 404);
      await academicScope(req, paper, paper.branchId);
      if (!['draft', 'revision_requested'].includes(paper.status)) {
        invalid('Only draft or revision-requested papers can be submitted for review.', 409);
      }
      const now = new Date();
      await db.collection('examPapers').updateOne(
        { ...req.paperScope, id: paperId },
        {
          $set: {
            status: 'in_review',
            submittedForReviewAt: now,
            submittedForReviewBy: req.user.id,
            updatedAt: now,
          },
        },
      );
      const updated = await db.collection('examPapers').findOne({ ...req.paperScope, id: paperId }, { projection: { _id: 0 } });
      res.json({ success: true, data: updated });
    }),
  );

  router.post(
    '/:id/approve',
    handle(async (req, res) => {
      if (!['principal', 'super_admin'].includes(req.user.role)) {
        invalid('Principal or Super Admin authority is required to approve exam papers.', 403);
      }
      const db = database();
      const paperId = String(id(req.params.id));
      const paper = await db.collection('examPapers').findOne({
        ...req.paperScope,
        id: paperId,
      });
      if (!paper) invalid('Paper not found.', 404);
      await academicScope(req, paper, paper.branchId);
      const decision = req.body?.decision || 'approved';
      if (!['approved', 'revision_requested'].includes(decision)) {
        invalid('Decision must be approved or revision_requested.', 400);
      }
      const reviewNotes = text(req.body?.reviewNotes, 'Review notes', 1000, true, paper.script === 'urdu');
      const now = new Date();
      await db.collection('examPapers').updateOne(
        { ...req.paperScope, id: paperId },
        {
          $set: {
            status: decision,
            reviewNotes,
            reviewedBy: req.user.id,
            reviewedAt: now,
            updatedAt: now,
          },
        },
      );
      const updated = await db.collection('examPapers').findOne({ ...req.paperScope, id: paperId }, { projection: { _id: 0 } });
      res.json({ success: true, data: updated });
    }),
  );

  router.post(
    '/:id/publish',
    handle(async (req, res) => {
      if (!['principal', 'super_admin'].includes(req.user.role)) {
        invalid('Principal or Super Admin authority is required to publish exam papers.', 403);
      }
      const db = database();
      const paperId = String(id(req.params.id));
      const paper = await db.collection('examPapers').findOne({
        ...req.paperScope,
        id: paperId,
      });
      if (!paper) invalid('Paper not found.', 404);
      await academicScope(req, paper, paper.branchId);
      if (paper.status !== 'approved') {
        invalid('Exam paper must be approved before it can be published.', 409);
      }
      const now = new Date();
      await db.collection('examPapers').updateOne(
        { ...req.paperScope, id: paperId },
        {
          $set: {
            status: 'published',
            published: true,
            publishedBy: req.user.id,
            publishedAt: now,
            updatedAt: now,
          },
        },
      );
      const updated = await db.collection('examPapers').findOne({ ...req.paperScope, id: paperId }, { projection: { _id: 0 } });
      res.json({ success: true, data: updated });
    }),
  );

  router.get(
    '/:id/pdf',
    handle(async (req, res) => {
      const paper = await database()
        .collection('examPapers')
        .findOne({
          ...req.paperScope,
          id: String(id(req.params.id)),
          ...(req.user.role === 'teacher' ? { createdBy: req.user.id } : {}),
        });
      if (!paper) invalid('Paper not found.', 404);
      await academicScope(req, paper, paper.branchId);
      const pdf = await render(paper, paper.templateSnapshot);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        data: {
          filename: `exam-${paper.id}.pdf`,
          mimeType: 'application/pdf',
          base64: pdf.toString('base64'),
        },
      });
    }),
  );

  router.use((error, _req, res, _next) =>
    res
      .status(error.status || 500)
      .json({ success: false, error: error.status ? error.message : 'Paper operation failed.' }),
  );
  return router;
}

module.exports = {
  validateTemplate,
  validatePaper,
  validateQuestionItem,
  shapeUrduTextForPdf,
  renderPaperPdf,
  createExamPaperRouter,
};
