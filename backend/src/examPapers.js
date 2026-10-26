const express = require('express');
const crypto = require('node:crypto');
const {ObjectId} = require('mongodb');
const {getDatabase} = require('./database');

function invalid(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function id(value) {
  if (value instanceof ObjectId) return value;
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) invalid('A valid record ID is required.');
  return new ObjectId(value);
}
function text(value, label, limit, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) invalid(`${label} is missing or too long.`);
  // Built-in PDF fonts support Latin text. Do not silently corrupt Urdu/other scripts.
  if (/[^\x20-\x7E\n\r\t\u00A0-\u00FF]/.test(value)) invalid(`${label}: this version supports Latin text only; an embedded font is required for other scripts.`);
  return value.trim();
}
function validateTemplate(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Provide a template object.');
  const margin = Number(body.margin ?? 42);
  if (!['A4', 'LETTER'].includes(body.pageSize) || !Number.isInteger(margin) || margin < 24 || margin > 72) invalid('Choose A4/LETTER and a margin between 24 and 72 points.');
  return {name: text(body.name, 'Template name', 80), pageSize: body.pageSize, margin,
    header: text(body.header, 'Header', 200, true), footer: text(body.footer, 'Footer', 200, true)};
}
function validatePaper(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Provide a paper object.');
  const durationMinutes = Number(body.durationMinutes);
  const totalMarks = Number(body.totalMarks);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 360) invalid('Duration must be 5–360 minutes.');
  if (!Number.isInteger(totalMarks) || totalMarks < 1 || totalMarks > 1000) invalid('Total marks must be 1–1000.');
  if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 100) invalid('Provide 1–100 questions.');
  const questions = body.questions.map(question => {
    if (!question || typeof question !== 'object' || Array.isArray(question)) invalid('Each question must be an object.');
    const marks = Number(question.marks);
    if (!Number.isInteger(marks) || marks < 1 || marks > 100) invalid('Each question requires 1–100 marks.');
    return {text: text(question.text, 'Question', 4000), marks};
  });
  if (questions.reduce((sum, q) => sum + q.marks, 0) !== totalMarks) invalid('Question marks must equal total marks.');
  return {title: text(body.title, 'Paper title', 150), instructions: text(body.instructions, 'Instructions', 2000, true),
    durationMinutes, totalMarks, questions, templateId: String(id(body.templateId)),
    classId: String(id(body.classId)), sectionId: String(id(body.sectionId)), subjectId: String(id(body.subjectId))};
}
async function renderPaperPdf(paper, template) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({size: template.pageSize, margins: {top: template.margin, bottom: template.margin + 20, left: template.margin, right: template.margin}, bufferPages: true});
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk)); doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font('Helvetica-Bold').fontSize(17).text(paper.schoolName, {align: 'center'});
    if (template.header) doc.font('Helvetica').fontSize(10).text(template.header, {align: 'center'});
    doc.moveDown().font('Helvetica-Bold').fontSize(14).text(paper.title, {align: 'center'});
    doc.moveDown().font('Helvetica').fontSize(10).text(`${paper.className} / ${paper.sectionName}  |  ${paper.subjectName}`);
    doc.text(`Duration: ${paper.durationMinutes} minutes     Total marks: ${paper.totalMarks}`);
    doc.moveDown().text('Student name: _________________________   Roll no: ______________');
    if (paper.instructions) doc.moveDown().text(paper.instructions);
    paper.questions.forEach((question, index) => {
      const value = `${index + 1}. ${question.text}  [${question.marks} marks]`;
      doc.moveDown();
      if (doc.y + Math.min(doc.heightOfString(value), 120) > doc.page.height - doc.page.margins.bottom) doc.addPage();
      doc.font('Helvetica').fontSize(11).text(value);
    });
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(8).text(`${template.footer || ''}     Page ${i + 1} of ${range.count}`, template.margin, doc.page.height - template.margin, {width: doc.page.width - 2 * template.margin, align: 'center', lineBreak: false});
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
function createExamPaperRouter({database = getDatabase, render = renderPaperPdf} = {}) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try {
      if (!req.user) invalid('Authentication is required.', 401);
      if (!['teacher', 'principal', 'super_admin'].includes(req.user.role)) invalid('Academic staff access is required.', 403);
      const actor = req.authenticatedUserRecord;
      if (!actor?.schoolId) invalid('The account needs a verified school mapping before paper access.', 503);
      const db = database();
      const school = await db.collection('schools').findOne({_id: id(actor.schoolId)});
      if (!school || school.active === false || school.isActive === false || school.status === 'suspended') invalid('School access is unavailable.', 403);
      req.paperScope = {schoolId: String(school._id)};
      req.paperSchool = school;
      next();
    } catch (error) {next(error);}
  });
  async function branchFor(req, branchId) {
    const actor = req.authenticatedUserRecord;
    const branch = await database().collection('branches').findOne({_id: id(branchId)});
    if (!branch || String(branch.schoolId) !== req.paperScope.schoolId || branch.isActive === false) invalid('Branch not found.', 404);
    if (req.user.role !== 'super_admin' && String(actor.branchId) !== String(branch._id)) invalid('Branch not found.', 404);
    return branch;
  }
  async function academicScope(req, fields, branchId) {
    await branchFor(req, branchId);
    const db = database(); const branch = id(branchId);
    const cls = await db.collection('schoolclasses').findOne({_id: id(fields.classId), branchId: branch, isActive: true});
    const section = await db.collection('sections').findOne({_id: id(fields.sectionId), branchId: branch, classId: id(fields.classId), isActive: true});
    const subject = await db.collection('subjects').findOne({_id: id(fields.subjectId), branchId: branch, isActive: true});
    if (!cls || !section || !subject) invalid('Academic records are unavailable for this branch.', 404);
    if (req.user.role === 'teacher') {
      const now = new Date();
      const assignment = await db.collection('teacherassignments').findOne({teacherId: id(req.authenticatedUserRecord._id), branchId: branch,
        classId: cls._id, sectionId: section._id, subjectId: subject._id, isActive: true, revokedAt: null, validFrom: {$lte: now},
        $or: [{validUntil: null}, {validUntil: {$gt: now}}]});
      if (!assignment) invalid('Current teacher assignment is required.', 403);
    }
    return {className: cls.name, sectionName: section.name, subjectName: subject.name};
  }
  const handle = action => async (req, res, next) => {try {await action(req, res);} catch (error) {next(error);}};
  router.get('/catalog', handle(async (req, res) => {
    const db = database();
    const branches = await db.collection('branches').find({$or: [{schoolId: req.paperScope.schoolId}, {schoolId: id(req.paperScope.schoolId)}],
      ...(req.user.role !== 'super_admin' ? {_id: id(req.authenticatedUserRecord.branchId)} : {}), isActive: {$ne: false}}, {projection: {_id: 1, name: 1}}).limit(100).toArray();
    const branchIds = branches.map(row => row._id);
    const filter = {branchId: {$in: branchIds}, isActive: true};
    const [classes, sections, subjects] = await Promise.all(['schoolclasses', 'sections', 'subjects'].map(name => db.collection(name).find(filter, {projection: {_id: 1, name: 1, branchId: 1, classId: 1}}).limit(1000).toArray()));
    let allowedClasses = classes, allowedSections = sections, allowedSubjects = subjects;
    if (req.user.role === 'teacher') {
      const now = new Date();
      const assignments = await db.collection('teacherassignments').find({teacherId: id(req.authenticatedUserRecord._id), branchId: {$in: branchIds}, isActive: true, revokedAt: null,
        validFrom: {$lte: now}, $or: [{validUntil: null}, {validUntil: {$gt: now}}]}).limit(1000).toArray();
      const includes = (key, row) => assignments.some(a => String(a[key]) === String(row._id));
      allowedClasses = classes.filter(row => includes('classId', row));
      allowedSections = sections.filter(row => includes('sectionId', row));
      allowedSubjects = subjects.filter(row => includes('subjectId', row));
    }
    res.json({success: true, data: {branches, classes: allowedClasses, sections: allowedSections, subjects: allowedSubjects}});
  }));
  router.get('/templates', handle(async (req, res) => res.json({success: true, data: await database().collection('examPrintTemplates').find(req.paperScope, {projection: {_id: 0}}).limit(100).toArray()})));
  router.post('/templates', handle(async (req, res) => {
    if (req.user.role === 'teacher') invalid('School administrators manage templates.', 403);
    const record = {...validateTemplate(req.body), ...req.paperScope, id: crypto.randomBytes(12).toString('hex'), createdBy: req.user.id, createdAt: new Date()};
    await database().collection('examPrintTemplates').insertOne(record);
    res.status(201).json({success: true, data: record});
  }));
  router.get('/', handle(async (req, res) => {
    const filter = {...req.paperScope, ...(req.user.role !== 'super_admin' ? {branchId: String(req.authenticatedUserRecord.branchId)} : {}), ...(req.user.role === 'teacher' ? {createdBy: req.user.id} : {})};
    const papers = await database().collection('examPapers').find(filter, {projection: {_id: 0}}).sort({createdAt: -1}).limit(100).toArray();
    const accessible = [];
    for (const paper of papers) {
      try {await academicScope(req, paper, paper.branchId); accessible.push(paper);}
      catch (error) {if (![403, 404].includes(error.status)) throw error;}
    }
    res.json({success: true, data: accessible});
  }));
  router.post('/', handle(async (req, res) => {
    const fields = validatePaper(req.body);
    const branchId = String(id(req.user.role === 'super_admin' ? req.body.branchId : req.authenticatedUserRecord.branchId));
    const names = await academicScope(req, fields, branchId);
    const template = await database().collection('examPrintTemplates').findOne({...req.paperScope, id: fields.templateId});
    if (!template) invalid('Template not found.', 404);
    const record = {...fields, ...names, ...req.paperScope, branchId, schoolName: text(req.paperSchool.name, 'School name', 150),
      id: crypto.randomBytes(12).toString('hex'), status: 'draft', createdBy: req.user.id, createdAt: new Date(), templateSnapshot: {...validateTemplate(template)}};
    await database().collection('examPapers').insertOne(record);
    res.status(201).json({success: true, data: record});
  }));
  router.get('/:id/pdf', handle(async (req, res) => {
    const paper = await database().collection('examPapers').findOne({...req.paperScope, id: String(id(req.params.id)), ...(req.user.role === 'teacher' ? {createdBy: req.user.id} : {})});
    if (!paper) invalid('Paper not found.', 404);
    await academicScope(req, paper, paper.branchId);
    const pdf = await render(paper, paper.templateSnapshot);
    res.setHeader('Cache-Control', 'no-store');
    res.json({success: true, data: {filename: `exam-${paper.id}.pdf`, mimeType: 'application/pdf', base64: pdf.toString('base64')}});
  }));
  router.use((error, _req, res, _next) => res.status(error.status || 500).json({success: false, error: error.status ? error.message : 'Paper operation failed.'}));
  return router;
}
module.exports = {validateTemplate, validatePaper, renderPaperPdf, createExamPaperRouter};
