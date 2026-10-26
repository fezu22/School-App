import {ensureStaffSelfServiceIndexes} from './models/staffSelfService';
import {ensureLiveLessonIndexes} from './models/liveLessonSession';
import {liveLessonService} from './services/live-lesson.service';
import {ensureAttendanceAmendmentIndexes} from './models/attendanceAmendment';
import 'dotenv/config';
import {Syllabus} from './models/syllabus';
import {LessonPlan} from './models/lessonPlan';
import {LessonDelivery} from './models/lessonDelivery';
import {ensureAcademicWorkIndexes} from './services/academic-work.service';
import {ensureAcademicEvidenceIndexes} from './services/academic-evidence.service';
import {ensureCatchUpIndexes} from './services/catch-up.service';
import {ensureAcademicResultIndexes} from './services/academic-result.service';
import {ensureTeacherNotificationIndexes} from './services/teacher-notification.service';
import mongoose from 'mongoose';
import {ensureAcademicSetupIndexes} from './services/academic-setup.service';

import app from './app';
import connectDatabase from './config/database';
import Subject from './models/subject';
import TeacherAssignment from './models/teacherAssignment';
import {ensureTimetableIndexes} from './models/timetable';
import {ensureAttendanceIndexes} from './models/periodAttendance';
import {ensureTeacherNoticeIndexes} from './models/teacherNotice';
import {AssignedWork} from './models/assignedWork';
import Student from './models/student';
import SchoolNotice from './models/schoolNotice';
import {ensureTeacherAccountIndex} from './services/teacher-provisioning.service';
import {ensureAssignmentAdminIndexes} from './services/teacher-assignment-admin.service';

const PORT = process.env.PORT || 5000;

const startServer = async (): Promise<void> => {
  await connectDatabase();
  await ensureAcademicSetupIndexes();
  await ensureStaffSelfServiceIndexes();
  await ensureLiveLessonIndexes();
  let classroomMaintenance = false;
  const classroomTimer = setInterval(() => {
    if (process.env.LIVE_LESSONS_VERIFIED !== 'true') return;
    if (classroomMaintenance) return;
    classroomMaintenance = true;
    liveLessonService.maintainClassrooms().catch(() => {
      console.warn(JSON.stringify({operation: 'live.classroom.maintenance', category: 'unavailable'}));
    }).finally(() => { classroomMaintenance = false; });
  }, 10000);
  classroomTimer.unref();
  await ensureTeacherAccountIndex();
  await ensureAttendanceAmendmentIndexes();
  await ensureAssignmentAdminIndexes();
  await Promise.all([Syllabus.createIndexes(), LessonPlan.createIndexes(), LessonDelivery.createIndexes()]);
  await ensureAcademicWorkIndexes();
  await ensureAcademicEvidenceIndexes();
  await ensureCatchUpIndexes();
  await ensureAcademicResultIndexes();
  await ensureTeacherNotificationIndexes();
  // These new domain invariants must exist before accepting traffic, including
  // deployments with autoIndex disabled. Only the documented legacy issue index is replaced.
  await Promise.all([Subject.createIndexes(), TeacherAssignment.createIndexes(), ensureTimetableIndexes(), ensureAttendanceIndexes(), ensureTeacherNoticeIndexes(), AssignedWork.createIndexes(), Student.createIndexes(), SchoolNotice.createIndexes()]);

  const topology = await mongoose.connection.db!.admin().command({hello: 1});
  if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('Academic setup, Teacher Assignment and Timetable mutations require a MongoDB replica set or sharded cluster');

  const PORT_NUM = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;

  if (isNaN(PORT_NUM)) {
    throw new Error('Invalid PORT');
  }

  app.listen(PORT_NUM, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();
