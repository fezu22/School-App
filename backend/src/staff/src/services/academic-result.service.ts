import {type SessionAuthority} from './authenticated-session.service';
import {createHash} from 'node:crypto';
import mongoose, {type ClientSession} from 'mongoose';
import ApprovalRequest from '../models/approvalRequest';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Student from '../models/student';
import Subject from '../models/subject';
import User from '../models/user';
import {AcademicResult} from '../models/academicResult';
import {Homework} from '../models/homework';
import {Quiz} from '../models/quiz';
import {HomeworkSubmission} from '../models/homeworkSubmission';
import {QuizAttempt} from '../models/quizAttempt';
import {TeacherReview} from '../models/teacherReview';
import {PERMISSIONS} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';
import {ApprovalAccessError, assertApprovalAuthority} from './approval-authority.policy';
import {currentAcademicActor, getTeacherScope, requireActiveAcademicBranch, type TeacherAssignmentTuple} from './teacher-scope.service';
import {communicationFence, exactTuple, withTeacherCommunication, type Identity} from './teacher-communication-access.service';
import {type JwtPayload} from './jwt.service';
import {withPrincipalWriteAuthority} from './principal-write-access.service';
import {StudentEnrollment} from '../models/studentEnrollment';
import {enumField, objectBody, objectIdField, textField, RequestContractError} from '../utils/request-validation';

type SourceType = 'homework_submission'|'quiz_attempt';
const unavailable=()=>new RequestContractError(404,'Result is unavailable or outside your scope');
const conflict=(message='Result changed; refresh and retry')=>new RequestContractError(409,message);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const operationId=(value:unknown)=>{const id=textField(value,'client operation ID',80,16);if(!/^[A-Za-z0-9_-]+$/.test(id))throw new RequestContractError(400,'Invalid client operation ID');return id;};
const expectedRevision=(value:unknown)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw new RequestContractError(400,'Invalid result revision');return value;};
const marks=(value:unknown,name='awarded marks')=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||Math.round(value*100)!==value*100)throw new RequestContractError(400,`Invalid ${name}`);return value;};
const optionalText=(value:unknown,name:string,max:number,min=0)=>value===undefined?'':textField(value,name,max,min);
const sourceModel=(type:SourceType)=>type==='homework_submission'?HomeworkSubmission:QuizAttempt;
const workModel=(type:SourceType)=>type==='homework_submission'?Homework:Quiz;
const evidenceRevision=(type:SourceType,row:any)=>type==='homework_submission'?row.submissionRevision:row.revision;
const workId=(type:SourceType,row:any)=>type==='homework_submission'?row.homeworkId:row.quizId;
const tupleFor=(scope:Awaited<ReturnType<typeof getTeacherScope>>,row:any)=>scope.tuples.find(v=>v.classId===String(row.classId)&&v.sectionId===String(row.sectionId)&&v.subjectId===String(row.subjectId));
const currentResultRevision=(row:any)=>row.revisions.find((v:any)=>v.revision===row.currentRevision)!;

const sourceAuthority=async(identity:Identity,typeValue:unknown,evidenceIdValue:unknown,session?:ClientSession)=>{
  const type=enumField(typeValue,'assessment source',['homework_submission','quiz_attempt']as const),scope=await getTeacherScope(identity);
  if(!ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.RESULTS_VIEW)||!ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE))throw new RequestContractError(403,'Result management is unavailable');
  const evidence:any=await (sourceModel(type)as any).findOne({_id:objectIdField(evidenceIdValue,'evidence ID'),branchId:scope.branchId}).read('primary').session(session??null);
  if(!evidence)throw unavailable();
  const work:any=await (workModel(type)as any).findOne({_id:workId(type,evidence),branchId:scope.branchId,status:'published',publishedRevision:evidence.publishedRevision}).read('primary').session(session??null);
  if(!work||String(evidence.studentId)===''||String(evidence.classId)!==String(work.classId)||String(evidence.sectionId)!==String(work.sectionId)||String(evidence.subjectId)!==String(work.subjectId))throw unavailable();
  const tuple=tupleFor(scope,work);if(!tuple)throw unavailable();
  const review:any=await TeacherReview.findOne({branchId:scope.branchId,workType:type==='homework_submission'?'homework':'quiz',targetType:type,evidenceId:evidence._id,evidenceRevision:evidenceRevision(type,evidence),studentId:evidence.studentId,recipientUserId:evidence.recipientUserId,workId:work._id,publishedRevision:work.publishedRevision,state:{$in:['reviewed','feedback_released']}}).read('primary').session(session??null);
  if(!review||typeof review.totalScore!=='number'||typeof review.maxScore!=='number'||!Number.isFinite(review.totalScore)||!Number.isFinite(review.maxScore)||review.maxScore<=0||review.totalScore<0||review.totalScore>review.maxScore)throw unavailable();
  return{type,scope,evidence,work,review,tuple};
};

const validateDraft=(input:Record<string,unknown>,review:any)=>{const awarded=marks(input.awardedMarks),max=marks(review.maxScore,'source maximum');if(max<=0||awarded>max)throw new RequestContractError(400,'Awarded marks exceed the source maximum');
  const differs=awarded!==review.totalScore,overrideReason=optionalText(input.overrideReason,'override reason',1000,differs?3:0);if(differs&&!overrideReason)throw new RequestContractError(400,'Override reason is required');
  return{awardedMarks:awarded,maxMarks:max,sourceScore:review.totalScore,sourceMax:review.maxScore,overrideReason,teacherPrivateNote:optionalText(input.teacherPrivateNote,'Teacher private note',4000)};};
const replay=(row:any,op:string,payloadHash:string)=>{const event=row.history.find((v:any)=>v.operationId===op);if(!event)return false;if(event.fingerprint!==payloadHash)throw conflict('Operation ID was reused');return true;};

const sourceSummary=async(row:any)=>{const review:any=await TeacherReview.findOne({_id:row.sourceReviewId,branchId:row.branchId}).select('state totalScore maxScore revision evidenceRevision').lean();return{type:row.assessmentSourceType,workId:String(row.sourceWorkId),publishedRevision:row.sourcePublishedRevision,evidenceId:String(row.sourceEvidenceId),evidenceRevision:row.sourceEvidenceRevision,reviewId:String(row.sourceReviewId),reviewRevision:row.sourceReviewRevision,reviewState:review?.state??'unavailable',score:review?.totalScore??null,maxScore:review?.maxScore??null};};
const teacherDTO=async(row:any,names:Pick<TeacherAssignmentTuple,'className'|'sectionName'|'subjectName'>)=>({resultId:String(row._id),recordRevision:row.recordRevision,currentRevision:row.currentRevision,status:row.status,
  academic:{classId:String(row.classId),sectionId:String(row.sectionId),subjectId:String(row.subjectId),className:names.className,sectionName:names.sectionName,subjectName:names.subjectName,academicYear:row.academicYear},
  student:{studentId:String(row.studentId),fullName:row.studentName??'',admissionNumber:row.admissionNumber??''},assessmentTitle:row.assessmentTitle,source:await sourceSummary(row),
  revisions:row.revisions.map((v:any)=>({revision:v.revision,awardedMarks:v.awardedMarks,maxMarks:v.maxMarks,sourceScore:v.sourceScore,sourceMax:v.sourceMax,overrideReason:v.overrideReason??'',teacherPrivateNote:v.teacherPrivateNote??'',createdAt:v.createdAt.toISOString(),submittedAt:v.submittedAt?.toISOString()??null})),
  submittedRevision:row.submittedRevision??null,moderationHistory:row.moderationHistory.map((v:any)=>({resultRevision:v.resultRevision,action:v.action,note:v.note??'',createdAt:v.createdAt.toISOString()})),publishedRevision:row.publishedRevision??null,publishedAt:row.publishedAt?.toISOString()??null,
  history:row.history.map((v:any)=>({resultRevision:v.resultRevision,action:v.action,actorRole:v.actorRole,reason:v.reason??'',createdAt:v.createdAt.toISOString()}))});
const attachStudentName=async(row:any)=>{const student:any=await Student.findOne().where('_id').equals(row.studentId).where('branchId').equals(row.branchId).select('userId admissionNumber').lean(),user:any=student?await User.findOne({_id:student.userId,branchId:row.branchId,role:'student'}).select('fullName').lean():null;row.studentName=user?.fullName??'';row.admissionNumber=student?.admissionNumber??'';return row;};

export const listTeacherResults=async(identity:Identity,query:unknown)=>{const input=objectBody(query,['classId','sectionId','subjectId']),scope=await getTeacherScope(identity),tuple=exactTuple(scope,{classId:objectIdField(input.classId,'class ID'),sectionId:objectIdField(input.sectionId,'section ID'),subjectId:objectIdField(input.subjectId,'subject ID')});
  const rows:any[]=await AcademicResult.find({branchId:scope.branchId,classId:tuple.classId,sectionId:tuple.sectionId,subjectId:tuple.subjectId}).sort({updatedAt:-1}).limit(100).read('primary'),items=[];for(const row of rows)items.push(await teacherDTO(await attachStudentName(row),tuple));
  const reviews:any[]=await TeacherReview.find({branchId:scope.branchId,state:{$in:['reviewed','feedback_released']}}).sort({updatedAt:-1}).limit(100).read('primary'),sources=[];for(const review of reviews){try{const auth=await sourceAuthority(identity,review.targetType,String(review.evidenceId));if(auth.tuple.assignmentId!==tuple.assignmentId)continue;const existing=rows.find(v=>String(v.sourceReviewId)===String(review._id));const student:any=await Student.findById(auth.evidence.studentId).select('admissionNumber').lean(),user:any=student?await User.findById(student.userId).select('fullName').lean():null;sources.push({targetType:auth.type,evidenceId:String(auth.evidence._id),reviewId:String(review._id),title:auth.work.title,student:{fullName:user?.fullName??'',admissionNumber:student?.admissionNumber??''},score:review.totalScore,maxScore:review.maxScore,resultId:existing?String(existing._id):null});}catch(error){if(!(error instanceof RequestContractError)&&!(error instanceof ApprovalAccessError))throw error;}}
  return{sources,items,total:items.length};};

export const createTeacherResult=async(identity:Identity,token:SessionAuthority,body:unknown)=>{const input=objectBody(body,['targetType','evidenceId','awardedMarks','overrideReason','teacherPrivateNote','clientOperationId']),op=operationId(input.clientOperationId),initial=await sourceAuthority(identity,input.targetType,input.evidenceId),draft=validateDraft(input,initial.review),payloadHash=hash({action:'create',type:initial.type,evidenceId:String(initial.evidence._id),...draft});
  const prior:any=await AcademicResult.findOne({teacherId:initial.scope.actorId,'history.operationId':op}).read('primary');if(prior){if(!replay(prior,op,payloadHash))throw conflict();return teacherDTO(await attachStudentName(prior),initial.tuple);}
  try{return await withTeacherCommunication(identity,token,PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE,initial.tuple,async session=>{const auth=await sourceAuthority(identity,initial.type,String(initial.evidence._id),session);for(const[collection,id]of[[sourceModel(auth.type).collection.name,String(auth.evidence._id)],[workModel(auth.type).collection.name,String(auth.work._id)],[TeacherReview.collection.name,String(auth.review._id)]])await communicationFence(session,collection,id);
    const existing:any=await AcademicResult.findOne({sourceReviewId:auth.review._id}).session(session);if(existing){if(replay(existing,op,payloadHash))return teacherDTO(await attachStudentName(existing),auth.tuple);throw conflict('A result already exists for this review');}
    const now=new Date(),row:any=await AcademicResult.create([{branchId:auth.scope.branchId,teacherId:auth.scope.actorId,assignmentId:auth.tuple.assignmentId,studentId:auth.evidence.studentId,recipientUserId:auth.evidence.recipientUserId,classId:auth.work.classId,sectionId:auth.work.sectionId,subjectId:auth.work.subjectId,academicYear:auth.work.academicYear,assessmentSourceType:auth.type,sourceWorkId:auth.work._id,sourcePublishedRevision:auth.work.publishedRevision,sourceEvidenceId:auth.evidence._id,sourceEvidenceRevision:evidenceRevision(auth.type,auth.evidence),sourceReviewId:auth.review._id,sourceReviewRevision:auth.review.revision,syllabusId:auth.work.syllabusId,syllabusVersion:auth.work.syllabusVersion,topicIds:auth.work.topicIds,assessmentTitle:auth.work.title,revisions:[{revision:1,...draft,createdBy:auth.scope.actorId,createdAt:now}],currentRevision:1,recordRevision:1,status:'draft',history:[{resultRevision:1,action:'draft_created',actorId:auth.scope.actorId,actorRole:'teacher',reason:draft.overrideReason,createdAt:now,operationId:op,fingerprint:payloadHash}]}],{session});return teacherDTO(await attachStudentName(row[0]),auth.tuple);});}catch(error){if((error as{code?:number}).code===11000)throw conflict('A result already exists for this review');throw error;}};

const teacherResultContext=async(identity:Identity,id:unknown)=>{const scope=await getTeacherScope(identity),row:any=await AcademicResult.findOne({_id:objectIdField(id,'result ID'),branchId:scope.branchId}).read('primary');if(!row)throw unavailable();const tuple=tupleFor(scope,row);if(!tuple)throw unavailable();return{scope,row,tuple};};
export const getTeacherResult=async(identity:Identity,id:unknown)=>{const ctx=await teacherResultContext(identity,id);return teacherDTO(await attachStudentName(ctx.row),ctx.tuple);};
export const mutateTeacherResult=async(identity:Identity,token:SessionAuthority,id:unknown,body:unknown)=>{const input=objectBody(body,['action','recordRevision','awardedMarks','overrideReason','teacherPrivateNote','clientOperationId']),action=enumField(input.action,'result action',['save_draft','submit','create_revision']as const),expected=expectedRevision(input.recordRevision),op=operationId(input.clientOperationId),initial=await teacherResultContext(identity,id),payloadHash=hash({...input,resultId:String(initial.row._id)});
  return withTeacherCommunication(identity,token,PERMISSIONS.TEACHER_ASSESSMENTS_MANAGE,initial.tuple,async session=>{let row:any=await AcademicResult.findById(initial.row._id).session(session);if(!row)throw unavailable();if(replay(row,op,payloadHash))return teacherDTO(await attachStudentName(row),initial.tuple);if(row.recordRevision!==expected)throw conflict();if(['published','rejected','submitted_for_moderation','resubmitted_for_moderation','moderated_approved'].includes(row.status))throw conflict('Result is not editable');
    const source=await sourceAuthority(identity,row.assessmentSourceType,String(row.sourceEvidenceId),session),review:any=source.review;
    if(String(source.work._id)!==String(row.sourceWorkId)||source.work.publishedRevision!==row.sourcePublishedRevision||String(source.evidence._id)!==String(row.sourceEvidenceId)||evidenceRevision(source.type,source.evidence)!==row.sourceEvidenceRevision||String(review._id)!==String(row.sourceReviewId)||review.revision!==row.sourceReviewRevision||String(source.evidence.studentId)!==String(row.studentId)||String(source.evidence.recipientUserId)!==String(row.recipientUserId))throw conflict('Source evidence changed');const now=new Date();
    if(action==='submit'){if(row.status!=='draft')throw conflict('Create a revision before resubmitting');const current=currentResultRevision(row);current.submittedAt=now;row.submittedRevision=row.currentRevision;row.status=row.currentRevision===1?'submitted_for_moderation':'resubmitted_for_moderation';let approval:any=row.approvalRequestId?await ApprovalRequest.findById(row.approvalRequestId).session(session):null;
      if(!approval)approval=new ApprovalRequest({branchId:row.branchId,requesterId:row.teacherId,entityType:'academic_result',entityId:row._id,resultRevision:row.currentRevision,approvalType:'result',reason:`Moderate ${row.assessmentTitle}`,status:'pending'});else{if(approval.status!=='changes_requested')throw conflict('Moderation request is not returnable');approval.status='pending';approval.resultRevision=row.currentRevision;approval.reason=`Moderate ${row.assessmentTitle}`;approval.reviewedBy=undefined;approval.reviewedAt=undefined;approval.history.push({action:'resubmitted',performedBy:row.teacherId,reason:'Revised result submitted',createdAt:now});}await approval.save({session});row.approvalRequestId=approval._id;
    }else{const draft=validateDraft(input,review);if(action==='create_revision'){if(row.status!=='returned_for_revision')throw conflict('Only a returned result can be revised');row.currentRevision+=1;row.revisions.push({revision:row.currentRevision,...draft,createdBy:initial.scope.actorId,createdAt:now});row.status='draft';}else{if(row.status!=='draft')throw conflict('Only a draft can be edited');Object.assign(currentResultRevision(row),draft);}}
    row.recordRevision+=1;row.history.push({resultRevision:row.currentRevision,action,actorId:initial.scope.actorId,actorRole:'teacher',reason:String(input.overrideReason??''),createdAt:now,operationId:op,fingerprint:payloadHash});await row.save({session});return teacherDTO(await attachStudentName(row),initial.tuple);});};

// Read authority and write authority share the existing role map and category policy.
const principalActor = async (identity: JwtPayload | undefined, manage = false) => {
  const actor = await currentAcademicActor(identity);
  if (actor.role !== 'principal' || !ROLE_PERMISSIONS.principal.includes(PERMISSIONS.RESULTS_VIEW) ||
      !ROLE_PERMISSIONS.principal.includes(manage ? PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE : PERMISSIONS.PRINCIPAL_APPROVALS_VIEW))
    throw new RequestContractError(403, 'Result moderation is not permitted');
  const branchId = await requireActiveAcademicBranch(actor.branchId?.toString());
  assertApprovalAuthority(String(actor._id), branchId, {approvalType: 'result'});
  return {actor, branchId};
};
const principalContext = async (identity: JwtPayload | undefined, approvalId: unknown, manage = false) => {
  const principal = await principalActor(identity, manage);
  const approval = await ApprovalRequest.findOne({_id: objectIdField(approvalId, 'approval ID'), branchId: principal.branchId, entityType: 'academic_result', approvalType: 'result'}).read('primary');
  if (!approval) throw unavailable();
  const row = await AcademicResult.findOne({_id: approval.entityId, branchId: principal.branchId, approvalRequestId: approval._id}).read('primary');
  if (!row || String(row.teacherId) === String(principal.actor._id)) throw unavailable();
  return {...principal, approval, row};
};
const resultAcademicContext = async (row: any, session?: ClientSession) => {
  const [schoolClass, section, subject, teacher] = await Promise.all([
    SchoolClass.findOne({_id: row.classId, branchId: row.branchId}).session(session ?? null).read('primary').lean(),
    Section.findOne({_id: row.sectionId, branchId: row.branchId, classId: row.classId}).session(session ?? null).read('primary').lean(),
    Subject.findOne({_id: row.subjectId, branchId: row.branchId}).session(session ?? null).read('primary').lean(),
    User.findOne({_id: row.teacherId, branchId: row.branchId}).select('fullName').session(session ?? null).read('primary').lean(),
  ]);
  return {className: schoolClass?.name ?? '', sectionName: section?.name ?? '', subjectName: subject?.name ?? '', teacherName: teacher?.fullName ?? '',
    valid: !!(schoolClass?.isActive && section?.isActive && subject?.isActive && schoolClass.academicYear === row.academicYear)};
};
const publishable = (row: any, approval: any) => approval.status === 'approved' && row.status === 'moderated_approved' &&
  row.publishedRevision == null && row.publishedAt == null && approval.resultRevision === row.currentRevision && row.submittedRevision === row.currentRevision;
const principalDTO = async (ctx: Awaited<ReturnType<typeof principalContext>>) => {
  const academic = await resultAcademicContext(ctx.row);
  const manage = ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE);
  const result = await teacherDTO(await attachStudentName(ctx.row), academic);
  // Teacher-only drafting notes are not required for Principal moderation.
  const revisions = result.revisions.map((revision: any) => ({revision: revision.revision, awardedMarks: revision.awardedMarks, maxMarks: revision.maxMarks, sourceScore: revision.sourceScore, sourceMax: revision.sourceMax, overrideReason: revision.overrideReason, createdAt: revision.createdAt, submittedAt: revision.submittedAt}));
  return {approvalId: String(ctx.approval._id), approvalStatus: ctx.approval.status, teacherName: academic.teacherName,
    configurationIssue: academic.valid ? null : 'Academic configuration requires administrator review before this result can be changed.',
    canModerate: manage && academic.valid && ctx.approval.status === 'pending' && ctx.approval.resultRevision === ctx.row.currentRevision &&
      ctx.row.submittedRevision === ctx.row.currentRevision && ['submitted_for_moderation', 'resubmitted_for_moderation'].includes(ctx.row.status),
    canPublish: manage && academic.valid && publishable(ctx.row, ctx.approval), result: {...result, revisions}};
};
export const getPrincipalResult = async (identity: JwtPayload | undefined, id: unknown) => principalDTO(await principalContext(identity, id));

// A bounded, server-filtered queue. Approval linkage and academic context are
// joined BEFORE pagination; the client never scans branch result history.
export const listPrincipalResults = async (identity: JwtPayload | undefined, query: unknown) => {
  const input = objectBody(query, ['state', 'search', 'offset', 'classId', 'sectionId', 'subjectId']);
  const principal = await principalActor(identity);
  const state = enumField(input.state ?? 'awaiting_publication', 'result queue', ['pending', 'awaiting_publication', 'published', 'returned', 'rejected'] as const);
  const offset = input.offset === undefined ? 0 : typeof input.offset === 'string' && /^\d{1,6}$/.test(input.offset) ? Number(input.offset) : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new RequestContractError(400, 'Invalid page offset');
  const search = input.search === undefined ? '' : textField(input.search, 'search', 80).toLowerCase();
  const states = {pending: ['submitted_for_moderation', 'resubmitted_for_moderation'], awaiting_publication: ['moderated_approved'], published: ['published'], returned: ['returned_for_revision'], rejected: ['rejected']};
  const branchId = new mongoose.Types.ObjectId(principal.branchId);
  const match: Record<string, unknown> = {branchId, status: {$in: states[state]}, teacherId: {$ne: principal.actor._id}};
  for (const key of ['classId', 'sectionId', 'subjectId']) if (input[key] !== undefined) match[key] = new mongoose.Types.ObjectId(objectIdField(input[key], key));
  if (state === 'awaiting_publication') Object.assign(match, {publishedRevision: null, publishedAt: null});
  const pipeline: mongoose.PipelineStage[] = [{$match: match},
    {$project: {branchId: 1, approvalRequestId: 1, classId: 1, sectionId: 1, subjectId: 1, teacherId: 1, recipientUserId: 1, academicYear: 1, assessmentTitle: 1, status: 1, currentRevision: 1, submittedRevision: 1, recordRevision: 1, publishedAt: 1, updatedAt: 1}},
    {$lookup: {from: ApprovalRequest.collection.name, localField: 'approvalRequestId', foreignField: '_id', pipeline: [{$match: {branchId, entityType: 'academic_result', approvalType: 'result'}}], as: 'approval'}}, {$unwind: '$approval'},
    {$match: {'approval.status': state === 'pending' ? 'pending' : state === 'returned' ? 'changes_requested' : state === 'rejected' ? 'rejected' : 'approved',
      $expr: {$and: [{$eq: ['$approval.entityId', '$_id']}, {$eq: ['$approval.resultRevision', '$currentRevision']}, {$eq: ['$submittedRevision', '$currentRevision']}]}}},
  ];
  for (const [from, localField, as] of [[SchoolClass.collection.name, 'classId', 'schoolClass'], [Section.collection.name, 'sectionId', 'section'], [Subject.collection.name, 'subjectId', 'subject'], [User.collection.name, 'teacherId', 'teacher'], [User.collection.name, 'recipientUserId', 'student']])
    pipeline.push({$lookup: {from, localField, foreignField: '_id', pipeline: [{$match: {branchId}}, {$project: {name: 1, fullName: 1, classId: 1, academicYear: 1, isActive: 1}}], as}}, {$set: {[as]: {$arrayElemAt: ['$' + as, 0]}}});
  pipeline.push({$set: {validContext: {$and: [{$eq: ['$schoolClass.isActive', true]}, {$eq: ['$section.isActive', true]}, {$eq: ['$subject.isActive', true]}, {$eq: ['$section.classId', '$classId']}, {$eq: ['$schoolClass.academicYear', '$academicYear']}]}}});
  if (search) pipeline.push({$match: {$expr: {$or: ['assessmentTitle', 'schoolClass.name', 'section.name', 'subject.name', 'teacher.fullName', 'student.fullName', 'academicYear'].map(field => ({$gte: [{$indexOfCP: [{$toLower: {$ifNull: ['$' + field, '']}}, search]}, 0]}))}}});
  pipeline.push({$facet: {items: [{$match: {validContext: true}}, {$sort: {updatedAt: -1, _id: -1}}, {$skip: offset}, {$limit: 20},
    {$project: {_id: 0, approvalId: {$toString: '$approvalRequestId'}, resultId: {$toString: '$_id'}, assessmentTitle: 1, status: 1, recordRevision: 1, academicYear: 1, className: '$schoolClass.name', sectionName: '$section.name', subjectName: '$subject.name', teacherName: {$ifNull: ['$teacher.fullName', '']}, studentName: {$ifNull: ['$student.fullName', '']}, publishedAt: 1}}],
    count: [{$match: {validContext: true}}, {$count: 'total'}], configuration: [{$match: {validContext: {$ne: true}}}, {$count: 'total'}]}});
  const [page] = await AcademicResult.aggregate(pipeline).read('primary');
  const total = page.count[0]?.total ?? 0;
  return {items: page.items, total, nextOffset: offset + page.items.length < total ? offset + page.items.length : null, configurationIssueCount: page.configuration[0]?.total ?? 0};
};

// P-PR1 owns persisted actor/Branch/exact-session fencing. The result and
// existing histories are provisional until those post-write fences succeed.
const principalResultWrite = async (initial: Awaited<ReturnType<typeof principalContext>>, token: SessionAuthority, write: (session: ClientSession) => Promise<void>) =>
  withPrincipalWriteAuthority({actorId: String(initial.actor._id), branchId: initial.branchId, token}, PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE, write, async session => {
    // Validate the transaction's actual record, including on driver retry.
    const row = await AcademicResult.findOne({_id: initial.row._id, branchId: initial.branchId, approvalRequestId: initial.approval._id}).session(session);
    if (!row || String(row.teacherId) === String(initial.actor._id)) throw unavailable();
    // Frozen evidence does not require the original Teacher assignment to
    // remain active, but the linked academic tuple must remain valid.
    for (const [collection, id] of [[SchoolClass.collection.name, row.classId], [Section.collection.name, row.sectionId], [Subject.collection.name, row.subjectId]])
      await communicationFence(session, String(collection), String(id));
    if (!(await resultAcademicContext(row, session)).valid) throw conflict('Academic configuration requires administrator review');
    // Configuration grants are rechecked after the last asynchronous reference read.
    assertApprovalAuthority(String(initial.actor._id), initial.branchId, {approvalType: 'result'});
    if (!ROLE_PERMISSIONS.principal.includes(PERMISSIONS.RESULTS_VIEW) || !ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_APPROVALS_VIEW))
      throw new RequestContractError(403, 'Result moderation is not permitted');
  });
const writeRecords = async (initial: Awaited<ReturnType<typeof principalContext>>, session: ClientSession) => {
  const row = await AcademicResult.findOne({_id: initial.row._id, branchId: initial.branchId, approvalRequestId: initial.approval._id}).session(session);
  const approval = await ApprovalRequest.findOne({_id: initial.approval._id, branchId: initial.branchId, entityId: initial.row._id, entityType: 'academic_result', approvalType: 'result'}).session(session);
  if (!row || !approval) throw unavailable();
  return {row, approval};
};
export const moderateResult = async (identity: JwtPayload | undefined, token: SessionAuthority, id: unknown, body: unknown) => {
  const input = objectBody(body, ['action', 'recordRevision', 'reason', 'clientOperationId']);
  const action = enumField(input.action, 'moderation action', ['approve', 'return', 'reject'] as const), expected = expectedRevision(input.recordRevision);
  const note = optionalText(input.reason, 'moderation reason', 1000, action === 'approve' ? 0 : 3), op = operationId(input.clientOperationId);
  const initial = await principalContext(identity, id, true), payloadHash = hash({...input, approvalId: String(initial.approval._id), reason: note});
  await principalResultWrite(initial, token, async session => {
    const {row, approval} = await writeRecords(initial, session);
    if (replay(row, op, payloadHash)) return;
    if (row.recordRevision !== expected || approval.status !== 'pending' || approval.resultRevision !== row.submittedRevision || row.submittedRevision !== row.currentRevision ||
        !['submitted_for_moderation', 'resubmitted_for_moderation'].includes(row.status)) throw conflict();
    const now = new Date(), mapped = action === 'approve' ? 'approved' : action === 'return' ? 'changes_requested' : 'rejected';
    row.status = action === 'approve' ? 'moderated_approved' : action === 'return' ? 'returned_for_revision' : 'rejected';
    row.recordRevision += 1;
    row.moderationHistory.push({resultRevision: row.submittedRevision!, action: action === 'approve' ? 'approved' : action === 'return' ? 'returned' : 'rejected', note, actorId: initial.actor._id, createdAt: now, operationId: op, fingerprint: payloadHash});
    row.history.push({resultRevision: row.submittedRevision!, action: 'moderation_' + action, actorId: initial.actor._id, actorRole: 'principal', reason: note, createdAt: now, operationId: op, fingerprint: payloadHash});
    approval.status = mapped; approval.reviewedBy = initial.actor._id as any; approval.reviewedAt = now;
    approval.history.push({action: mapped, performedBy: initial.actor._id as any, reason: note, createdAt: now, authority: 'direct'});
    await approval.save({session}); await row.save({session});
  });
  return principalDTO(await principalContext(identity, id));
};
export const publishResult = async (identity: JwtPayload | undefined, token: SessionAuthority, id: unknown, body: unknown) => {
  const input = objectBody(body, ['recordRevision', 'clientOperationId']), expected = expectedRevision(input.recordRevision), op = operationId(input.clientOperationId);
  const initial = await principalContext(identity, id, true), payloadHash = hash({...input, action: 'publish', approvalId: String(initial.approval._id)});
  await principalResultWrite(initial, token, async session => {
    const {row, approval} = await writeRecords(initial, session);
    if (replay(row, op, payloadHash)) return;
    if (row.recordRevision !== expected || !publishable(row, approval)) throw conflict();
    // Serialize changes to the linked approval as well as the result document.
    await communicationFence(session, ApprovalRequest.collection.name, String(approval._id));
    const now = new Date(); row.status = 'published'; row.publishedRevision = row.currentRevision;
    row.publishedAt = now; row.publishedBy = initial.actor._id; row.recordRevision += 1;
    row.history.push({resultRevision: row.currentRevision, action: 'published', actorId: initial.actor._id, actorRole: 'principal', createdAt: now, operationId: op, fingerprint: payloadHash});
    await row.save({session});
  });
  return principalDTO(await principalContext(identity, id));
};

const studentActor = async (identity: JwtPayload | undefined) => {
  const actor = await currentAcademicActor(identity);
  if (actor.role !== 'student' || !ROLE_PERMISSIONS.student.includes(PERMISSIONS.RESULTS_VIEW)) throw new RequestContractError(403, 'Student results are unavailable');
  const branchId = await requireActiveAcademicBranch(actor.branchId?.toString());
  const student = await Student.findOne({isActive: true}).where('userId').equals(actor._id).where('branchId').equals(branchId).read('primary');
  if (!student) throw unavailable();
  const managed = !!await StudentEnrollment.exists({studentId: student._id}).read('primary');
  // Published results retain legitimate historical membership after promotion,
  // transfer or withdrawal. A projection cannot grant a never-held placement.
  const now = new Date();
  const memberships = managed ? await StudentEnrollment.find({
    effectiveFrom: {$type: 'date', $lte: now},
    $or: [{status: 'active', effectiveTo: null}, {status: {$in: ['transferred', 'promoted', 'withdrawn']}, effectiveTo: {$type: 'date', $lte: now}, $expr: {$gte: ['$effectiveTo', '$effectiveFrom']}}],
  }).where('studentId').equals(student._id).where('branchId').equals(branchId).select('classId sectionId').read('primary').lean() : [student];
  const placements = memberships.map(row => ({classId: String(row.classId), sectionId: String(row.sectionId)}));
  return {actor, branchId, student, placements};
};
const studentResultFilter = (ctx: Awaited<ReturnType<typeof studentActor>>) => ({branchId: ctx.branchId, studentId: ctx.student._id,
  recipientUserId: ctx.actor._id, status: 'published' as const, publishedAt: {$type: 'date' as const},
  $and: [
    // Retain existing published legacy records without publication metadata;
    // an explicit revision, when present, must still match the frozen marks.
    {$or: [{publishedRevision: null}, {$expr: {$eq: ['$publishedRevision', '$currentRevision']}}]},
    {$or: ctx.placements.length ? ctx.placements : [{classId: {$in: []}}]},
  ]});
const studentDTO=async(row:any)=>{const revision=currentResultRevision(row),subject=await Subject.findById(row.subjectId).select('name').lean(),review:any=await TeacherReview.findOne({_id:row.sourceReviewId,branchId:row.branchId,studentId:row.studentId,recipientUserId:row.recipientUserId,state:'feedback_released'}).select('feedback releasedAt').lean();return{resultId:String(row._id),subject:{subjectId:String(row.subjectId),name:subject?.name??''},assessment:{type:row.assessmentSourceType==='homework_submission'?'homework':'quiz',title:row.assessmentTitle,publishedRevision:row.sourcePublishedRevision},awardedMarks:revision.awardedMarks,maxMarks:revision.maxMarks,percentage:Math.round(revision.awardedMarks/revision.maxMarks*10000)/100,publishedAt:row.publishedAt.toISOString(),releasedFeedback:review?{feedback:review.feedback??'',releasedAt:review.releasedAt?.toISOString()??null}:null};};
export const listStudentResults=async(identity:JwtPayload|undefined)=>{const ctx=await studentActor(identity),rows:any[]=await AcademicResult.find(studentResultFilter(ctx)).sort({publishedAt:-1}).read('primary'),items=[];for(const row of rows)items.push(await studentDTO(row));return{items,total:items.length};};
export const getStudentResult=async(identity:JwtPayload|undefined,id:unknown)=>{const ctx=await studentActor(identity),row:any=await AcademicResult.findOne({...studentResultFilter(ctx),_id:objectIdField(id,'result ID')}).read('primary');if(!row)throw unavailable();return studentDTO(row);};
export const ensureAcademicResultIndexes=()=>AcademicResult.createIndexes();
