import staffSelfServiceRoutes from './routes/staff-self-service.routes';
import attendanceAmendmentRoutes from './routes/attendance-amendment.routes';
import {academicAdminRouter, teacherAcademicRouter, principalAcademicRouter} from './routes/academic.routes';
import {liveLessonRouter} from './routes/live-lesson.routes';
import express, {ErrorRequestHandler} from 'express';
import cors from 'cors';
import branchRoutes from './routes/branch.routes';
import authRoutes from './routes/auth.routes';
import adminRoutes from './routes/admin.routes';
import principalRoutes from './routes/principal.routes';
import bootstrapRoutes from './routes/bootstrap.routes';
import approvalRequestRoutes from './routes/approval-request.routes';

import healthRoutes from './routes/health.routes';
import * as backupRoutesModule from './routes/backup.routes';
import usageRoutes from './routes/usage.routes';
import privilegedRequestRoutes from './routes/privileged-request.routes';
import automationRoutes from './routes/automation.routes';
import sessionRoutes from './routes/session.routes';
import teacherRoutes from './routes/teacher.routes';
import teacherHomeRoutes from './routes/teacher-home.routes';
import {teacherCommunicationRouter, assignedWorkManagementRouter} from './routes/teacher-communication.routes';
import teacherAttendanceRoutes from './routes/teacher-attendance.routes';
import {teacherTimetableRouter, timetableAdminRouter} from './routes/timetable.routes';
import teacherAssignmentRoutes from './routes/teacher-assignment.routes';
import {studentAcademicWorkRouter, teacherAcademicWorkRouter} from './routes/academic-work.routes';
import {studentEvidenceRouter, teacherReviewRouter} from './routes/academic-evidence.routes';
import {studentCatchUpRouter, teacherCatchUpRouter} from './routes/catch-up.routes';
import {principalResultRouter, studentResultRouter, teacherResultRouter} from './routes/academic-result.routes';
import teacherNotificationRoutes from './routes/teacher-notification.routes';
import {enrollmentRouter} from './routes/student-enrollment.routes';
import {academicSetupRouter} from './routes/academic-setup.routes';

const backupRoutes = (backupRoutesModule as any).default ?? backupRoutesModule;

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'School Management System API is running',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/principal', principalRoutes);
app.use('/api/bootstrap', bootstrapRoutes);
// Sanitize bootstrap JSON parser errors: Express's default development error
// response can include the submitted credential body and a stack trace.
const bootstrapParseError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({success: false, message: 'Invalid bootstrap request'});
    return;
  }
  next(error);
};
app.use('/api/bootstrap', bootstrapParseError);
app.use('/api/usage', usageRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/privileged-requests', privilegedRequestRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/students', enrollmentRouter);
// Integrated clients use a distinct namespace so legacy /students directory
// APIs retain their original authentication and response contracts.
app.use('/api/staff-students', enrollmentRouter);
app.use('/api/academic-setup', academicSetupRouter);
app.use('/api/health', healthRoutes);
app.use('/api/approval-requests', approvalRequestRoutes);
app.use('/api', attendanceAmendmentRoutes);
app.use('/api/teacher/self-service', staffSelfServiceRoutes);
app.use('/api/teacher/home', teacherHomeRoutes);
app.use('/api/syllabuses', academicAdminRouter);
app.use('/api/teacher/academic', teacherAcademicRouter);
app.use('/api/teacher/academic-work', teacherAcademicWorkRouter);
app.use('/api/student/academic-work', studentAcademicWorkRouter);
app.use('/api/student/evidence', studentEvidenceRouter);
app.use('/api/teacher/reviews', teacherReviewRouter);
app.use('/api/teacher/catch-ups', teacherCatchUpRouter);
app.use('/api/student/catch-ups', studentCatchUpRouter);
app.use('/api/teacher/results', teacherResultRouter);
app.use('/api/teacher', teacherNotificationRoutes);
app.use('/api/principal/results', principalResultRouter);
app.use('/api/student/results', studentResultRouter);
app.use('/api/principal/academic-review', principalAcademicRouter);
app.use('/api/teacher/timetable', teacherTimetableRouter);
app.use('/api/live-lessons', (_req, res, next) => {
  const { isZegoLiveLessonEnabled } = require('../../zegoConfig');
  if (!isZegoLiveLessonEnabled(process.env)) {
    res.status(503).json({success: false, message: 'Live lessons are disabled pending integration and provider verification.'});
    return;
  }
  next();
}, liveLessonRouter);
app.use('/api/teacher/attendance', teacherAttendanceRoutes);
app.use('/api/timetables', timetableAdminRouter);
app.use('/api/teacher', teacherCommunicationRouter);
app.use('/api/assigned-work', assignedWorkManagementRouter);
app.use('/api/teacher', teacherRoutes);
app.use('/api/teacher-assignments', teacherAssignmentRoutes);

const teacherParseError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    res.status(400).json({success: false, message: 'Invalid Teacher request body'});
    return;
  }
  next(error);
};
app.use('/api/teacher', teacherParseError);
app.use('/api/syllabuses', teacherParseError);
app.use('/api/assigned-work', teacherParseError);
app.use('/api/timetables', teacherParseError);
app.use('/api/teacher-assignments', teacherParseError);
app.use('/api/academic-setup', teacherParseError);
app.use('/api/students', teacherParseError);

// Credential parser errors must not echo submitted JSON or parser details.
const teacherAccountParseError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    res.status(400).json({success: false, message: 'Invalid Teacher account request body'});
    return;
  }
  next(error);
};
app.use('/api/admin/teachers', teacherAccountParseError);

// Scope parser failures to Principal APIs; leave bootstrap and other API error
// behavior unchanged. Never echo submitted JSON or the parser's stack/message.
const principalParseError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    res.status(400).json({
      success: false, message: 'Invalid Principal request body',
    });
    return;
  }
  next(error);
};
app.use('/api/principal', principalParseError);
app.use('/api/approval-requests', principalParseError);

export default app;
