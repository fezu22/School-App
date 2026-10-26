import assert from'node:assert/strict';import{after,before,beforeEach,test,mock}from'node:test';import type{Server}from'node:http';import mongoose from'mongoose';import{MongoMemoryReplSet}from'mongodb-memory-server';
import app from'../src/staff/src/app';import User,{type UserRole}from'../src/staff/src/models/user';import Branch from'../src/staff/src/models/branch';import Session from'../src/staff/src/models/session';import SchoolClass from'../src/staff/src/models/schoolClass';import Section from'../src/staff/src/models/section';import Subject from'../src/staff/src/models/subject';import Student from'../src/staff/src/models/student';import TeacherAssignment from'../src/staff/src/models/teacherAssignment';import ApprovalRequest from'../src/staff/src/models/approvalRequest';
import{Syllabus}from'../src/staff/src/models/syllabus';import{Homework}from'../src/staff/src/models/homework';import{AcademicWorkAudience}from'../src/staff/src/models/academicWorkAudience';import{HomeworkSubmission}from'../src/staff/src/models/homeworkSubmission';import{QuizAttempt}from'../src/staff/src/models/quizAttempt';import{TeacherReview}from'../src/staff/src/models/teacherReview';import{AcademicResult}from'../src/staff/src/models/academicResult';import{CatchUpItem}from'../src/staff/src/models/catchUpItem';import{AttendanceSession,PeriodAttendanceRecord}from'../src/staff/src/models/periodAttendance';
import {ROLE_PERMISSIONS} from '../src/staff/src/constants/rolePermissions';
import {PERMISSIONS} from '../src/staff/src/constants/permissions';
import {StudentEnrollment} from '../src/staff/src/models/studentEnrollment';
import{generateAccessToken}from'../src/staff/src/services/jwt.service';import{registerSession}from'../src/staff/src/services/session.service';import{ensureAcademicResultIndexes}from'../src/staff/src/services/academic-result.service';

let db:MongoMemoryReplSet,server:Server,base:string;let branch:any,foreign:any,teacher:any,other:any,foreignTeacher:any,principal:any,foreignPrincipal:any,learner:any,outsider:any;
let schoolClass:any,otherClass:any,section:any,otherSection:any,subject:any,otherSubject:any,assignment:any,student:any,otherStudent:any,syllabus:any,homework:any,entitlement:any,evidence:any,review:any;
const permissions=[...ROLE_PERMISSIONS.principal];
const old={secret:process.env.JWT_SECRET,authority:process.env.PRINCIPAL_APPROVAL_AUTHORITY};const oid=()=>new mongoose.Types.ObjectId();
const actor=async(role:UserRole,branchId=branch,name='Person')=>{const user=await User.create({fullName:name,email:`${oid()}@test.invalid`,password:'private',role,branchId});const token=generateAccessToken(String(user._id),role);await registerSession(String(user._id),token,role);return{id:user._id,token}};
const http=async(path:string,person:any,body?:unknown,method=body===undefined?'GET':'POST')=>{const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${person.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,json:await response.json()as any}};
const context=()=>`classId=${schoolClass._id}&sectionId=${section._id}&subjectId=${subject._id}`;
const create=async(body:Record<string,unknown>={},person=teacher)=>http('/teacher/results',person,{targetType:'homework_submission',evidenceId:String(evidence._id),awardedMarks:8,clientOperationId:'create_result_operation_01',...body});
const mutate=(id:string,body:any,person=teacher)=>http(`/teacher/results/${id}`,person,body);const approval=async(resultId:string)=>ApprovalRequest.findOne({entityId:resultId});
const decide=(approvalId:string,body:any,person=principal)=>http(`/principal/results/${approvalId}/moderate`,person,body);const publish=(approvalId:string,body:any,person=principal)=>http(`/principal/results/${approvalId}/publish`,person,body);
const submitted=async()=>{let value=(await create()).json.data;value=(await mutate(value.resultId,{action:'submit',recordRevision:value.recordRevision,clientOperationId:'submit_result_operation_01'})).json.data;return{value,request:await approval(value.resultId)}};

before(async()=>{process.env.JWT_SECRET='result-security-secret';db=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(db.getUri(),{dbName:'result_security',autoIndex:false});await ensureAcademicResultIndexes();server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address()as{port:number}).port}/api`});
beforeEach(async()=>{mock.restoreAll();ROLE_PERMISSIONS.principal=[...permissions];await StudentEnrollment.deleteMany({});for(const model of[AcademicResult,TeacherReview,QuizAttempt,HomeworkSubmission,AcademicWorkAudience,Homework,Syllabus,CatchUpItem,PeriodAttendanceRecord,AttendanceSession,ApprovalRequest,TeacherAssignment,Student,Subject,Section,SchoolClass,Session,User,Branch])await model.collection.deleteMany({});
 branch=(await Branch.create({name:'Branch A',code:'AA',address:'private',city:'Lahore'}))._id;foreign=(await Branch.create({name:'Branch B',code:'BB',address:'private',city:'Lahore'}))._id;teacher=await actor('teacher',branch,'Ayesha Teacher');other=await actor('teacher',branch,'Other Teacher');foreignTeacher=await actor('teacher',foreign,'Foreign Teacher');principal=await actor('principal',branch,'Principal One');foreignPrincipal=await actor('principal',foreign,'Principal Foreign');learner=await actor('student',branch,'Learner One');outsider=await actor('student',branch,'Learner Two');
 process.env.PRINCIPAL_APPROVAL_AUTHORITY=JSON.stringify({[String(principal.id)]:{branchId:String(branch),types:['result']},[String(foreignPrincipal.id)]:{branchId:String(foreign),types:['result']}});
 schoolClass=await SchoolClass.create({branchId:branch,name:'Grade 8',code:'8',academicYear:'2026-27'});otherClass=await SchoolClass.create({branchId:branch,name:'Grade 9',code:'9',academicYear:'2026-27'});section=await Section.create({branchId:branch,classId:schoolClass._id,name:'A',code:'A'});otherSection=await Section.create({branchId:branch,classId:otherClass._id,name:'B',code:'B'});subject=await Subject.create({branchId:branch,name:'Mathematics'});otherSubject=await Subject.create({branchId:branch,name:'Science'});assignment=await TeacherAssignment.create({teacherId:teacher.id,branchId:branch,classId:schoolClass._id,sectionId:section._id,subjectId:subject._id,validFrom:new Date(Date.now()-86400000),validUntil:new Date(Date.now()+86400000*30),createdBy:teacher.id,updatedBy:teacher.id});
 student=await Student.create({userId:learner.id,branchId:branch,classId:schoolClass._id,sectionId:section._id,admissionNumber:'A-1'});otherStudent=await Student.create({userId:outsider.id,branchId:branch,classId:schoolClass._id,sectionId:section._id,admissionNumber:'A-2'});const topicId=oid(),unitId=oid();syllabus=await Syllabus.create({branchId:branch,classId:schoolClass._id,subjectId:subject._id,academicYear:'2026-27',title:'Mathematics',version:1,revision:1,status:'published',units:[{_id:unitId,title:'Numbers',order:1,topics:[{_id:topicId,title:'Integers',order:1,outcomes:[]}]}],createdBy:teacher.id,updatedBy:teacher.id,publishedBy:teacher.id,publishedAt:new Date()});
 homework=await Homework.create({branchId:branch,teacherId:teacher.id,assignmentId:assignment._id,classId:schoolClass._id,sectionId:section._id,subjectId:subject._id,academicYear:'2026-27',syllabusId:syllabus._id,syllabusVersion:1,lessonPlanId:oid(),lessonPlanRevision:1,lessonDeliveryId:oid(),topicIds:[topicId],title:'Integer Practice',instructions:'Complete',dueAt:'2026-10-20',latePolicy:'closed_after_due_date',status:'published',revision:1,publishedRevision:1,publishedAt:new Date(),recipientCount:1,createOperationId:'homework_create_operation_001',createFingerprint:'homework-create'});entitlement=await AcademicWorkAudience.create({branchId:branch,workType:'homework',workId:homework._id,publishedRevision:1,studentId:student._id,recipientUserId:learner.id,admissionNumber:'A-1',studentName:'Learner One',entitledAt:new Date()});
 evidence=await HomeworkSubmission.create({branchId:branch,homeworkId:homework._id,publishedRevision:1,audienceEntitlementId:entitlement._id,studentId:student._id,recipientUserId:learner.id,classId:schoolClass._id,sectionId:section._id,subjectId:subject._id,syllabusId:syllabus._id,syllabusVersion:1,lessonPlanId:homework.lessonPlanId,lessonPlanRevision:1,lessonDeliveryId:homework.lessonDeliveryId,topicIds:[topicId],submissionRevision:1,status:'reviewed',revisions:[{revision:1,content:'Answer',submittedAt:new Date(),timing:'on_time',operationId:'submission_operation_001',fingerprint:'submission'}]});review=await TeacherReview.create({branchId:branch,workType:'homework',workId:homework._id,publishedRevision:1,targetType:'homework_submission',evidenceId:evidence._id,studentId:student._id,recipientUserId:learner.id,reviewerId:teacher.id,evidenceRevision:1,revision:2,state:'reviewed',scores:[{criterionId:'quality',score:8}],totalScore:8,maxScore:10,feedback:'Good work',privateNote:'Teacher only',reviewedAt:new Date(),history:[]});
});
after(async()=>{mock.restoreAll();ROLE_PERMISSIONS.principal=permissions;if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await mongoose.disconnect();if(db)await db.stop();if(old.secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=old.secret;if(old.authority===undefined)delete process.env.PRINCIPAL_APPROVAL_AUTHORITY;else process.env.PRINCIPAL_APPROVAL_AUTHORITY=old.authority});

test('authorized Teacher creates a source-linked result draft',async()=>{const r=await create();assert.equal(r.status,200,JSON.stringify(r.json));assert.equal(r.json.data.status,'draft');assert.equal(r.json.data.source.reviewId,String(review._id));assert.equal(r.json.data.revisions[0].awardedMarks,8)});
test('unassigned Teacher cannot create or discover result',async()=>{assert.equal((await create({},other)).status,404)});
test('wrong branch Teacher is denied',async()=>{assert.equal((await create({},foreignTeacher)).status,404)});
test('wrong class section subject cross-product is denied',async()=>{await Homework.collection.updateOne({_id:homework._id},{$set:{classId:otherClass._id,sectionId:otherSection._id,subjectId:otherSubject._id}});assert.equal((await create()).status,404)});
test('guessed source review evidence is concealed',async()=>{assert.equal((await create({evidenceId:String(oid())})).status,404)});
test('source Student mismatch is rejected',async()=>{await TeacherReview.collection.updateOne({_id:review._id},{$set:{studentId:otherStudent._id}});assert.equal((await create()).status,404)});
test('source published revision mismatch is rejected',async()=>{await Homework.collection.updateOne({_id:homework._id},{$set:{publishedRevision:2}});assert.equal((await create()).status,404)});
test('source review evidence revision mismatch is rejected',async()=>{await TeacherReview.collection.updateOne({_id:review._id},{$set:{evidenceRevision:2}});assert.equal((await create()).status,404)});
test('marks above maximum are rejected',async()=>{assert.equal((await create({awardedMarks:11,overrideReason:'Impossible override'})).status,400)});
test('negative marks are rejected',async()=>{assert.equal((await create({awardedMarks:-1,overrideReason:'Negative'})).status,400)});
test('non-finite or malformed marks are rejected',async()=>{assert.equal((await create({awardedMarks:null})).status,400);assert.equal((await create({awardedMarks:'8'})).status,400)});
test('invalid decimal precision is rejected',async()=>{assert.equal((await create({awardedMarks:7.777,overrideReason:'Precision'})).status,400)});
test('client source maximum injection is rejected',async()=>{assert.equal((await create({maxMarks:100})).status,400)});
test('override requires an explicit reason',async()=>{assert.equal((await create({awardedMarks:7})).status,400);assert.equal((await create({awardedMarks:7,overrideReason:'Moderated Teacher judgment'})).status,200)});
test('duplicate create retry replays one draft and conflicting reuse fails',async()=>{const first=await create();assert.equal((await create()).json.data.resultId,first.json.data.resultId);assert.equal(await AcademicResult.countDocuments(),1);assert.equal((await create({awardedMarks:7,overrideReason:'Changed'})).status,409)});
test('submission freezes the submitted result revision',async()=>{const{value}=await submitted();assert.equal(value.status,'submitted_for_moderation');assert.equal(value.submittedRevision,1);assert.equal((await mutate(value.resultId,{action:'save_draft',recordRevision:value.recordRevision,awardedMarks:7,overrideReason:'Late edit',clientOperationId:'late_edit_operation_01'})).status,409)});
test('stale Teacher edit is rejected',async()=>{let v=(await create()).json.data;v=(await mutate(v.resultId,{action:'save_draft',recordRevision:v.recordRevision,awardedMarks:7,overrideReason:'Documented change',clientOperationId:'edit_result_operation_01'})).json.data;assert.equal((await mutate(v.resultId,{action:'save_draft',recordRevision:1,awardedMarks:6,overrideReason:'Stale change',clientOperationId:'stale_edit_operation_01'})).status,409)});
test('Principal with exact branch and category moderates',async()=>{const{value,request}=await submitted();const r=await decide(String(request!._id),{action:'approve',recordRevision:value.recordRevision,clientOperationId:'approve_result_operation_01'});assert.equal(r.status,200,JSON.stringify(r.json));assert.equal(r.json.data.result.status,'moderated_approved')});
test('foreign Principal cannot moderate guessed approval',async()=>{const{value,request}=await submitted();assert.equal((await decide(String(request!._id),{action:'approve',recordRevision:value.recordRevision,clientOperationId:'approve_result_operation_01'},foreignPrincipal)).status,404)});
test('Principal without configured category authority is denied',async()=>{const{value,request}=await submitted();process.env.PRINCIPAL_APPROVAL_AUTHORITY='{}';assert.equal((await decide(String(request!._id),{action:'approve',recordRevision:value.recordRevision,clientOperationId:'approve_result_operation_01'})).status,403)});
test('stale moderation revision is rejected',async()=>{const{request}=await submitted();assert.equal((await decide(String(request!._id),{action:'approve',recordRevision:1,clientOperationId:'approve_result_operation_01'})).status,409)});
test('double moderation retry is idempotent and changed reuse conflicts',async()=>{const{value,request}=await submitted(),body={action:'approve',recordRevision:value.recordRevision,clientOperationId:'approve_result_operation_01'};assert.equal((await decide(String(request!._id),body)).status,200);assert.equal((await decide(String(request!._id),body)).status,200);assert.equal((await decide(String(request!._id),{...body,action:'reject',reason:'Changed decision'})).status,409)});
test('return opens an explicit next-revision path',async()=>{const{value,request}=await submitted();let response=await decide(String(request!._id),{action:'return',recordRevision:value.recordRevision,reason:'Recheck score evidence',clientOperationId:'return_result_operation_01'});let result=response.json.data.result;assert.equal(result.status,'returned_for_revision');result=(await mutate(result.resultId,{action:'create_revision',recordRevision:result.recordRevision,awardedMarks:7,overrideReason:'Principal-requested correction',teacherPrivateNote:'Updated',clientOperationId:'revise_result_operation_01'})).json.data;assert.equal(result.currentRevision,2);assert.equal(result.revisions.length,2);assert.equal(result.revisions[0].awardedMarks,8)});
test('prior revision stays immutable through resubmission',async()=>{const{value,request}=await submitted();let result=(await decide(String(request!._id),{action:'return',recordRevision:value.recordRevision,reason:'Revise',clientOperationId:'return_result_operation_01'})).json.data.result;result=(await mutate(result.resultId,{action:'create_revision',recordRevision:result.recordRevision,awardedMarks:7,overrideReason:'Corrected scoring',clientOperationId:'revise_result_operation_01'})).json.data;result=(await mutate(result.resultId,{action:'submit',recordRevision:result.recordRevision,clientOperationId:'resubmit_result_operation_01'})).json.data;assert.equal(result.status,'resubmitted_for_moderation');assert.deepEqual(result.revisions.map((v:any)=>v.awardedMarks),[8,7])});
test('approved result remains Student invisible before publish',async()=>{const{value,request}=await submitted();await decide(String(request!._id),{action:'approve',recordRevision:value.recordRevision,clientOperationId:'approve_result_operation_01'});assert.equal((await http('/student/results',learner)).json.data.total,0)});
test('explicit publication makes only safe result visible',async()=>{const{value,request}=await submitted();let detail=(await decide(String(request!._id),{action:'approve',recordRevision:value.recordRevision,clientOperationId:'approve_result_operation_01'})).json.data;await publish(String(request!._id),{recordRevision:detail.result.recordRevision,clientOperationId:'publish_result_operation_01'});const r=await http('/student/results',learner),body=JSON.stringify(r.json.data);assert.equal(r.json.data.total,1);assert.equal(r.json.data.items[0].awardedMarks,8);for(const key of['teacherPrivateNote','moderationHistory','history','operationId','fingerprint','privateNote'])assert.equal(body.includes(key),false)});
test('non-published result is concealed from Student list and detail',async()=>{const v=(await create()).json.data;assert.equal((await http('/student/results',learner)).json.data.total,0);assert.equal((await http(`/student/results/${v.resultId}`,learner)).status,404)});
test('Student cannot see another Student published result',async()=>{const{value,request}=await submitted();let detail=(await decide(String(request!._id),{action:'approve',recordRevision:value.recordRevision,clientOperationId:'approve_result_operation_01'})).json.data;await publish(String(request!._id),{recordRevision:detail.result.recordRevision,clientOperationId:'publish_result_operation_01'});assert.equal((await http(`/student/results/${value.resultId}`,outsider)).status,404)});
test('moderation and Teacher private notes never reach Student',async()=>{let v=(await create({teacherPrivateNote:'Teacher secret'})).json.data;v=(await mutate(v.resultId,{action:'submit',recordRevision:v.recordRevision,clientOperationId:'submit_result_operation_01'})).json.data;const request=await approval(v.resultId);let detail=(await decide(String(request!._id),{action:'approve',recordRevision:v.recordRevision,reason:'Principal private note',clientOperationId:'approve_result_operation_01'})).json.data;await publish(String(request!._id),{recordRevision:detail.result.recordRevision,clientOperationId:'publish_result_operation_01'});const body=JSON.stringify((await http(`/student/results/${v.resultId}`,learner)).json.data);assert.equal(body.includes('Teacher secret'),false);assert.equal(body.includes('Principal private note'),false)});
test('published result cannot be directly edited',async()=>{const{value,request}=await submitted();let detail=(await decide(String(request!._id),{action:'approve',recordRevision:value.recordRevision,clientOperationId:'approve_result_operation_01'})).json.data;detail=(await publish(String(request!._id),{recordRevision:detail.result.recordRevision,clientOperationId:'publish_result_operation_01'})).json.data;assert.equal((await mutate(value.resultId,{action:'save_draft',recordRevision:detail.result.recordRevision,awardedMarks:9,overrideReason:'Illegal edit',clientOperationId:'edit_published_operation_01'})).status,409)});
test('Catch-up completion does not modify result',async()=>{const v=(await create()).json.data;await CatchUpItem.collection.insertOne({_id:oid(),branchId:branch,studentId:student._id,recipientUserId:learner.id,classId:schoolClass._id,sectionId:section._id,subjectId:subject._id,status:'completed'});assert.equal((await AcademicResult.findById(v.resultId))!.revisions[0].awardedMarks,8)});
test('attendance changes do not modify result',async()=>{const v=(await create()).json.data;const session=await AttendanceSession.create({branchId:branch,periodId:oid(),timetableVersionId:oid(),date:'2026-10-17',classId:schoolClass._id,sectionId:section._id,subjectId:subject._id,responsibleTeacherId:teacher.id,rosterVersion:'v1',rosterStudentIds:[student._id],state:'submitted',revision:1,submittedBy:teacher.id,submittedAt:new Date()});const row=await PeriodAttendanceRecord.create({branchId:branch,attendanceSessionId:session._id,studentId:student._id,status:'absent',markedBy:teacher.id,markedAt:new Date(),revision:1});await PeriodAttendanceRecord.updateOne({_id:row._id},{$set:{status:'present'}});assert.equal((await AcademicResult.findById(v.resultId))!.revisions[0].awardedMarks,8)});
test('missing work does not auto-create a zero result',async()=>{await HomeworkSubmission.deleteMany({});await TeacherReview.deleteMany({});const r=await http(`/teacher/results?${context()}`,teacher);assert.equal(r.json.data.sources.length,0);assert.equal(await AcademicResult.countDocuments(),0)});
test('concurrent Teacher saves have one winner and one conflict',async()=>{const v=(await create()).json.data,b=(marks:number,op:string)=>mutate(v.resultId,{action:'save_draft',recordRevision:v.recordRevision,awardedMarks:marks,overrideReason:'Concurrent scoring',clientOperationId:op});const responses=await Promise.all([b(7,'concurrent_edit_operation_01'),b(6,'concurrent_edit_operation_02')]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409])});
test('concurrent moderation has one terminal decision',async()=>{const{value,request}=await submitted(),responses=await Promise.all([decide(String(request!._id),{action:'approve',recordRevision:value.recordRevision,clientOperationId:'concurrent_approve_operation_01'}),decide(String(request!._id),{action:'reject',recordRevision:value.recordRevision,reason:'Reject race',clientOperationId:'concurrent_reject_operation_01'})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409])});
test('publish retry is idempotent and conflicting reuse fails',async()=>{const{value,request}=await submitted();let detail=(await decide(String(request!._id),{action:'approve',recordRevision:value.recordRevision,clientOperationId:'approve_result_operation_01'})).json.data,body={recordRevision:detail.result.recordRevision,clientOperationId:'publish_result_operation_01'};assert.equal((await publish(String(request!._id),body)).status,200);assert.equal((await publish(String(request!._id),body)).status,200);assert.equal((await publish(String(request!._id),{...body,recordRevision:999})).status,409)});
test('rejected result is preserved, terminal and invisible',async()=>{const{value,request}=await submitted();const result=(await decide(String(request!._id),{action:'reject',recordRevision:value.recordRevision,reason:'Invalid academic basis',clientOperationId:'reject_result_operation_01'})).json.data.result;assert.equal(result.status,'rejected');assert.equal(await AcademicResult.countDocuments({_id:result.resultId}),1);assert.equal((await http('/student/results',learner)).json.data.total,0);assert.equal((await publish(String(request!._id),{recordRevision:result.recordRevision,clientOperationId:'publish_rejected_operation_01'})).status,409)});
test('past substitute or source reviewer gains no ongoing marks authority',async()=>{await TeacherReview.updateOne({_id:review._id},{$set:{reviewerId:other.id}});assert.equal((await create({},other)).status,404);assert.equal((await create()).status,200)});
test('AI and authority injection fields are rejected',async()=>{assert.equal((await create({aiRecommendedScore:9})).status,400);const v=(await create()).json.data;assert.equal((await mutate(v.resultId,{action:'submit',recordRevision:v.recordRevision,clientOperationId:'submit_result_operation_01',published:true})).status,400)});


test('approved unpublished result is rediscoverable through the Principal return queue', async () => {
  const {value, request} = await submitted();
  await decide(String(request!._id), {action:'approve', recordRevision:value.recordRevision, clientOperationId:'approve_result_operation_01'});
  const queue = await http('/principal/results?state=awaiting_publication', principal);
  assert.equal(queue.status, 200, JSON.stringify(queue.json));
  assert.equal(queue.json.data.total, 1);
  assert.equal(queue.json.data.items[0].approvalId, String(request!._id));
});

const approved = async () => {
  const {value, request} = await submitted();
  const response = await decide(String(request!._id), {action:'approve', recordRevision:value.recordRevision, clientOperationId:'approve_result_operation_01'});
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return {detail:response.json.data, id:String(request!._id)};
};
const publishApproved = (id:string, detail:any, op='publish_result_operation_01', person=principal) => publish(id, {recordRevision:detail.result.recordRevision, clientOperationId:op}, person);

test('queue and detail enforce foreign Branch concealment and active persisted actor', async () => {
  const {id} = await approved();
  assert.equal((await http('/principal/results?state=awaiting_publication',foreignPrincipal)).json.data.total,0);
  assert.equal((await http('/principal/results/'+id,foreignPrincipal)).status,404);
  await Branch.updateOne({_id:branch},{$set:{isActive:false}});
  assert.equal((await http('/principal/results',principal)).status,403);
});
test('awaiting queue excludes pending, returned and rejected result states',async()=>{
  const {value,request}=await submitted();
  assert.equal((await http('/principal/results?state=pending',principal)).json.data.total,1);
  assert.equal((await http('/principal/results',principal)).json.data.total,0);
  await decide(String(request!._id),{action:'return',reason:'Review evidence',recordRevision:value.recordRevision,clientOperationId:'return_result_operation_01'});
  assert.equal((await http('/principal/results',principal)).json.data.total,0);
  assert.equal((await http('/principal/results?state=returned',principal)).json.data.total,1);
});
test('published queue replaces awaiting publication and retains detail history',async()=>{
  const {id,detail}=await approved();
  const response=await publishApproved(id,detail);
  assert.equal(response.status,200,JSON.stringify(response.json));
  assert.equal(response.json.data.canPublish,false);
  assert.equal((await http('/principal/results',principal)).json.data.total,0);
  assert.equal((await http('/principal/results?state=published',principal)).json.data.total,1);
  assert.deepEqual(response.json.data.result.history.map((v:any)=>v.action),['draft_created','submit','moderation_approve','published']);
});
test('queue search, academic filters and pagination run on the server with bounded safe DTOs',async()=>{
  const {id,detail}=await approved();
  const source:any=await AcademicResult.findById(detail.result.resultId).lean();
  for(let i=0;i<22;i++){
    const resultId=oid(),approvalId=oid();
    const copy={...source};delete copy._id;delete copy.__v;
    await AcademicResult.collection.insertOne({...copy,_id:resultId,sourceReviewId:oid(),approvalRequestId:approvalId});
    await ApprovalRequest.collection.insertOne({_id:approvalId,branchId:branch,entityId:resultId,entityType:'academic_result',approvalType:'result',requesterId:teacher.id,status:'approved',resultRevision:1});
  }
  const first=await http('/principal/results?search=mathematics&'+context(),principal);
  assert.equal(first.status,200,JSON.stringify(first.json));assert.equal(first.json.data.items.length,20);assert.equal(first.json.data.total,23);assert.equal(first.json.data.nextOffset,20);
  const second=await http('/principal/results?offset=20',principal);assert.equal(second.json.data.items.length,3);assert.equal(second.json.data.nextOffset,null);
  assert.equal(new Set([...first.json.data.items,...second.json.data.items].map((v:any)=>v.resultId)).size,23);
  assert.equal((await http('/principal/results?search=does-not-match',principal)).json.data.total,0);
  assert.equal((await http('/principal/results?classId='+otherClass._id,principal)).json.data.total,0);
  const dto=JSON.stringify(first.json.data);for(const key of ['teacherPrivateNote','password','fingerprint','operationId','recipientUserId','revisions'])assert.equal(dto.includes(key),false);
  assert.equal((await http('/principal/results/'+id,principal)).json.data.teacherName,'Ayesha Teacher');
});
for(const query of ['state=draft','offset=-1','offset=1.2','offset=100001','branchId=foreign','search[x]=bad','classId=nope'])test('queue rejects unsupported filter '+query,async()=>{assert.equal((await http('/principal/results?'+query,principal)).status,400)});
for(const permission of [PERMISSIONS.RESULTS_VIEW,PERMISSIONS.PRINCIPAL_APPROVALS_VIEW])test('queue requires '+permission,async()=>{
  await approved();ROLE_PERMISSIONS.principal=permissions.filter(p=>p!==permission);assert.equal((await http('/principal/results',principal)).status,403);
});
test('view-only Principal receives no mutation capabilities',async()=>{
  const {id,detail}=await approved();ROLE_PERMISSIONS.principal=permissions.filter(p=>p!==PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE);
  const read=await http('/principal/results/'+id,principal);assert.equal(read.status,200);assert.equal(read.json.data.canPublish,false);assert.equal(read.json.data.canModerate,false);
  assert.equal((await publishApproved(id,detail)).status,403);
});
test('unconfigured Principal cannot read queue or publish',async()=>{
  const {id,detail}=await approved();process.env.PRINCIPAL_APPROVAL_AUTHORITY='{}';assert.equal((await http('/principal/results',principal)).status,403);assert.equal((await publishApproved(id,detail)).status,403);
});
test('invalid academic references are explicit configuration problems and cannot publish',async()=>{
  const {id,detail}=await approved();await Section.updateOne({_id:section._id},{$set:{isActive:false}});
  const queue=await http('/principal/results',principal);assert.equal(queue.json.data.total,0);assert.equal(queue.json.data.configurationIssueCount,1);
  const read=await http('/principal/results/'+id,principal);assert.equal(read.json.data.canPublish,false);assert.ok(read.json.data.configurationIssue);
  assert.equal((await publishApproved(id,detail)).status,409);assert.equal((await AcademicResult.findById(detail.result.resultId))!.status,'moderated_approved');
});
for(const decision of ['pending','return','reject'])test(decision+' result cannot publish',async()=>{
  const {value,request}=await submitted();let current=value;
  if(decision!=='pending')current=(await decide(String(request!._id),{action:decision,reason:'Review evidence',recordRevision:value.recordRevision,clientOperationId:'decision_result_operation_01'})).json.data.result;
  assert.equal((await publish(String(request!._id),{recordRevision:current.recordRevision,clientOperationId:'invalid_publish_operation_01'})).status,409);
  assert.equal((await AcademicResult.findById(value.resultId))!.history.filter(v=>v.action==='published').length,0);
});
test('stale revision cannot publish approved result or overwrite newer moderation',async()=>{
  const {id,detail}=await approved();assert.equal((await publish(id,{recordRevision:detail.result.recordRevision-1,clientOperationId:'stale_publish_operation_01'})).status,409);
  const beforeState=await AcademicResult.findById(detail.result.resultId).lean();
  assert.equal((await decide(id,{action:'reject',reason:'Obsolete decision',recordRevision:detail.result.recordRevision-1,clientOperationId:'stale_moderate_operation_01'})).status,409);
  assert.deepEqual(await AcademicResult.findById(detail.result.resultId).lean(),beforeState);
});
test('two Principals publish once; loser gets conflict and latest detail is non-publishable',async()=>{
  const {id,detail}=await approved(),peer=await actor('principal',branch,'Principal Two');
  const grants=JSON.parse(process.env.PRINCIPAL_APPROVAL_AUTHORITY!);grants[String(peer.id)]={branchId:String(branch),types:['result']};process.env.PRINCIPAL_APPROVAL_AUTHORITY=JSON.stringify(grants);
  const responses=await Promise.all([publishApproved(id,detail,'publish_actor_one_operation_01'),publishApproved(id,detail,'publish_actor_two_operation_01',peer)]);
  assert.deepEqual(responses.map(v=>v.status).sort(),[200,409]);
  const row=(await AcademicResult.findById(detail.result.resultId))!;assert.equal(row.recordRevision,detail.result.recordRevision+1);assert.equal(row.history.filter(v=>v.action==='published').length,1);
  const latest=await http('/principal/results/'+id,peer);assert.equal(latest.json.data.canPublish,false);assert.equal(latest.json.data.result.status,'published');
});
test('publication duplicate is idempotent only for the identical operation, with one history event',async()=>{
  const {id,detail}=await approved();await publishApproved(id,detail);
  assert.equal((await publishApproved(id,detail)).status,200);
  assert.equal((await publishApproved(id,detail,'second_publish_operation_01')).status,409);
  assert.equal((await AcademicResult.findById(detail.result.resultId))!.history.filter(v=>v.action==='published').length,1);
});
test('foreign Principal and Teacher never gain publication power',async()=>{
  const {id,detail}=await approved();assert.equal((await publishApproved(id,detail,'foreign_publish_operation_01',foreignPrincipal)).status,404);assert.equal((await publishApproved(id,detail,'teacher_publish_operation_01',teacher)).status,403);
});
const publicationAuthorityChanges = {
  'Branch transfer':()=>User.collection.updateOne({_id:principal.id},{$set:{branchId:foreign}}),
  'role demotion':()=>User.collection.updateOne({_id:principal.id},{$set:{role:'teacher'}}),
  'account disable':()=>User.collection.updateOne({_id:principal.id},{$set:{isActive:false}}),
  'session revoke':()=>Session.collection.updateMany({token:principal.token},{$set:{isRevoked:true}}),
  'Branch deactivation':()=>Branch.collection.updateOne({_id:branch},{$set:{isActive:false}}),
  'permission removal':async()=>{ROLE_PERMISSIONS.principal=permissions.filter(p=>p!==PERMISSIONS.PRINCIPAL_APPROVALS_MANAGE)},
  'category authority removal':async()=>{process.env.PRINCIPAL_APPROVAL_AUTHORITY='{}'},
};
// Independently committed authority changes after the actual provisional save.
// The whole result (including history, version and timestamps) must roll back.
for(const [name,change] of Object.entries(publicationAuthorityChanges))test('publication commit-time '+name+' rolls back entire result',async()=>{
  const {id,detail}=await approved(),beforeState=await AcademicResult.findById(detail.result.resultId).lean(),approvalBefore=await ApprovalRequest.findById(id).lean();
  const original=AcademicResult.prototype.save;let fired=false;
  mock.method(AcademicResult.prototype,'save',async function(this:any,...args:any[]){const value=await original.apply(this,args as any);if(!fired){fired=true;await change()}return value});
  const response=await publishApproved(id,detail);assert.equal(response.status,name==='session revoke'?401:403,JSON.stringify(response.json));assert.equal(fired,true);
  assert.deepEqual(await AcademicResult.findById(detail.result.resultId).lean(),beforeState);assert.deepEqual(await ApprovalRequest.findById(id).lean(),approvalBefore);
});
test('publication reference deactivation during save rolls back publication and history',async()=>{
  const {id,detail}=await approved(),beforeState=await AcademicResult.findById(detail.result.resultId).lean();const original=AcademicResult.prototype.save;let fired=false;
  mock.method(AcademicResult.prototype,'save',async function(this:any,...args:any[]){const value=await original.apply(this,args as any);if(!fired){fired=true;await Subject.updateOne({_id:subject._id},{$set:{isActive:false}})}return value});
  assert.equal((await publishApproved(id,detail)).status,409);assert.deepEqual(await AcademicResult.findById(detail.result.resultId).lean(),beforeState);
});
test('approved unpublished result is unavailable by Student detail as well as list',async()=>{
  const {detail}=await approved();assert.equal((await http('/student/results',learner)).json.data.total,0);assert.equal((await http('/student/results/'+detail.result.resultId,learner)).status,404);
});
for(const field of ['classId','sectionId'])test('published result is excluded when Student legacy '+field+' differs',async()=>{
  const {id,detail}=await approved();await publishApproved(id,detail);await Student.collection.updateOne({_id:student._id},{$set:{[field]:field==='classId'?otherClass._id:otherSection._id}});
  assert.equal((await http('/student/results',learner)).json.data.total,0);assert.equal((await http('/student/results/'+detail.result.resultId,learner)).status,404);
});
test('managed enrollment overrides stale legacy Student placement for result visibility',async()=>{
  const {id,detail}=await approved();await publishApproved(id,detail);
  await StudentEnrollment.create({studentId:student._id,branchId:branch,academicPeriodId:oid(),classId:otherClass._id,sectionId:otherSection._id,effectiveFrom:new Date(Date.now()-1000),reason:'Transfer',createdBy:principal.id,updatedBy:principal.id});
  assert.equal((await http('/student/results',learner)).json.data.total,0);assert.equal((await http('/student/results/'+detail.result.resultId,learner)).status,404);
});
test('eligible managed enrollment retains its own published history after withdrawal',async()=>{
  const {id,detail}=await approved();await publishApproved(id,detail);
  const enrollment=await StudentEnrollment.create({studentId:student._id,branchId:branch,academicPeriodId:oid(),classId:schoolClass._id,sectionId:section._id,effectiveFrom:new Date(Date.now()-1000),reason:'Enroll',createdBy:principal.id,updatedBy:principal.id});
  assert.equal((await http('/student/results/'+detail.result.resultId,learner)).status,200);
  await StudentEnrollment.updateOne({_id:enrollment._id},{$set:{status:'withdrawn',effectiveTo:new Date()}});
  assert.equal((await http('/student/results/'+detail.result.resultId,learner)).status,200);
});
test('foreign Branch Student is denied even with the correct recipient token',async()=>{
  const {id,detail}=await approved();await publishApproved(id,detail);await User.updateOne({_id:learner.id},{$set:{branchId:foreign}});
  assert.equal((await http('/student/results/'+detail.result.resultId,learner)).status,404);
});

test('Principal detail excludes Teacher-only notes while Teacher status and feedback remain available',async()=>{
  let value=(await create({teacherPrivateNote:'Teacher-only draft note'})).json.data;
  value=(await mutate(value.resultId,{action:'submit',recordRevision:value.recordRevision,clientOperationId:'submit_result_operation_01'})).json.data;
  const request=await approval(value.resultId),id=String(request!._id);
  const detail=await decide(id,{action:'approve',reason:'Evidence verified',recordRevision:value.recordRevision,clientOperationId:'approve_result_operation_01'});
  assert.equal(JSON.stringify(detail.json.data).includes('teacherPrivateNote'),false);
  assert.equal(JSON.stringify(detail.json.data).includes('Teacher-only draft note'),false);
  let teacherRead=await http('/teacher/results/'+value.resultId,teacher);assert.equal(teacherRead.json.data.status,'moderated_approved');assert.equal(teacherRead.json.data.moderationHistory[0].note,'Evidence verified');assert.equal(teacherRead.json.data.revisions[0].teacherPrivateNote,'Teacher-only draft note');
  await publishApproved(id,detail.json.data);
  teacherRead=await http('/teacher/results/'+value.resultId,teacher);assert.equal(teacherRead.json.data.status,'published');
});

test('publication and a stale moderation attempt cannot overwrite each other',async()=>{
  const {id,detail}=await approved();
  const responses=await Promise.all([publishApproved(id,detail),decide(id,{action:'reject',reason:'Stale pending review',recordRevision:detail.result.recordRevision-1,clientOperationId:'obsolete_review_operation_01'})]);
  assert.deepEqual(responses.map(v=>v.status),[200,409]);
  const row=(await AcademicResult.findById(detail.result.resultId))!;assert.equal(row.status,'published');assert.equal(row.history.filter(v=>v.action==='published').length,1);assert.equal(row.moderationHistory.length,1);
});

test('transaction retry validates the actual result references rather than the initial read',async()=>{
  const {id,detail}=await approved();const foreignSubject=await Subject.create({branchId:foreign,name:'Foreign subject'});
  const original=AcademicResult.prototype.save;let fired=false;
  mock.method(AcademicResult.prototype,'save',async function(this:any,...args:any[]){
    if(!fired){fired=true;await AcademicResult.collection.updateOne({_id:this._id},{$set:{subjectId:foreignSubject._id}})}
    return original.apply(this,args as any);
  });
  const response=await publishApproved(id,detail);assert.equal(response.status,409,JSON.stringify(response.json));assert.equal(fired,true);
  const row=(await AcademicResult.findById(detail.result.resultId))!;assert.equal(row.status,'moderated_approved');assert.equal(row.recordRevision,detail.result.recordRevision);assert.equal(row.history.filter(v=>v.action==='published').length,0);
});

test('category authority removed after academic fencing still rolls back publication',async()=>{
  const {id,detail}=await approved(),beforeState=await AcademicResult.findById(detail.result.resultId).lean();
  const original=Subject.collection.updateOne;let fired=false;
  mock.method(Subject.collection,'updateOne',async function(this:any,...args:any[]){const response=await original.apply(this,args as any);if(!fired){fired=true;process.env.PRINCIPAL_APPROVAL_AUTHORITY='{}'}return response});
  const response=await publishApproved(id,detail);assert.equal(fired,true);assert.equal(response.status,403,JSON.stringify(response.json));assert.deepEqual(await AcademicResult.findById(detail.result.resultId).lean(),beforeState);
});
