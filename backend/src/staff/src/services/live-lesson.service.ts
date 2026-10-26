import mongoose, { type ClientSession } from 'mongoose';
import User from '../models/user';
import Session from '../models/session';
import Student from '../models/student';
import SchoolClass from '../models/schoolClass';
import Section from '../models/section';
import Subject from '../models/subject';
import { currentEnrollment } from './student-enrollment.service';
import { AcademicPeriod } from '../models/academicPeriod';
import { ClassSubject } from '../models/classSubject';
import { TimetablePeriod } from '../models/timetable';
import {
  StudentEnrollment,
  activeEnrollmentFilter,
} from '../models/studentEnrollment';
import { LiveLessonSession } from '../models/liveLessonSession';
import { PERMISSIONS, type Permission } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';
import {
  currentAcademicActor,
  requireActiveAcademicBranch,
} from './teacher-scope.service';
import {
  mutateOccurrence,
  type TeacherPeriodDTO,
} from './teacher-timetable.service';
import { requireClassSubject } from './class-subject-context.service';
import { withAcademicCatalogLock } from './academic-catalog-lock.service';
import { schoolDateTime, schoolTimezone } from './school-date.service';
import type { JwtPayload } from './jwt.service';
import { verifyAccessToken } from './jwt.service';
import type { RtcProvider, RtcRole } from './rtc/rtc-provider';
import { rtcProvider } from './rtc/provider-factory';
import { LiveLessonPresence } from '../models/liveLessonPresence';
import {
  claim,
  closePresence,
  connectionKey,
  event,
  presenceDTO,
  presenceFor,
  rate,
} from './live-classroom-state';
import { kickZegoUser } from './rtc/zego-room-control';
import { createHash } from 'node:crypto';

const missing = () =>
  new RequestContractError(404, 'Live lesson is unavailable');
const conflict = () =>
  new RequestContractError(
    409,
    'Live lesson state or window does not allow this action',
  );
const START_EARLY_MS = 15 * 60 * 1000;
type Lesson = InstanceType<typeof LiveLessonSession>;
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');
const dto = (row: Lesson) => ({
  id: String(row._id),
  periodId: String(row.periodId),
  date: row.date,
  academicPeriodId: String(row.academicPeriodId),
  classId: String(row.classId),
  sectionId: String(row.sectionId),
  subjectId: String(row.subjectId),
  scheduledStart: row.scheduledStart.toISOString(),
  scheduledEnd: row.scheduledEnd.toISOString(),
  status: row.status,
  revision: row.revision,
  startedAt: row.startedAt?.toISOString() ?? null,
  endedAt: row.endedAt?.toISOString() ?? null,
});
async function actorFor(
  identity: JwtPayload | undefined,
  permission: Permission,
  session?: ClientSession,
) {
  const actor = await currentAcademicActor(identity, session);
  if (
    !['teacher', 'student'].includes(actor.role) ||
    !ROLE_PERMISSIONS[actor.role].includes(permission)
  )
    throw new RequestContractError(403, 'Live lesson permission is required');
  return actor;
}
async function fence(session: ClientSession, collection: string, id: unknown) {
  const result = await mongoose.connection
    .collection(collection)
    .updateOne(
      { _id: new mongoose.Types.ObjectId(String(id)) },
      { $inc: { __v: 1 } },
      { session },
    );
  if (!result.matchedCount) throw missing();
}
type LoginCredential = string | {readonly hash: string};
async function loginFence(
  session: ClientSession,
  identity: JwtPayload | undefined,
  token: LoginCredential,
  permission: Permission,
) {
  const actor = await actorFor(identity, permission);
  await fence(session, User.collection.name, actor._id);
  if (process.env.INTEGRATED_STAFF_ENABLED === 'true') {
    const stored = await User.collection.findOne({_id: actor._id}, {session});
    const ids = [String(actor._id)];
    if (typeof stored?.id === 'string') ids.push(stored.id);
    const hash = typeof token === 'string' ? createHash('sha256').update(token).digest('hex') : token.hash;
    const login = await mongoose.connection.collection('refreshTokens').updateOne(
      {tokenHash: hash, type: 'access', userId: {$in: ids}, revokedAt: null, expiresAt: {$gt: new Date()}},
      {$inc: {fenceVersion: 1}}, {session},
    );
    if (!login.matchedCount) throw new RequestContractError(401, 'Session is unavailable');
    return actorFor(identity, permission, session);
  }
  if (typeof token !== 'string') throw new RequestContractError(401, 'Session is unavailable');
  const login = await Session.collection.updateOne(
    { token, userId: actor._id, role: actor.role, isRevoked: false },
    { $inc: { __v: 1 } },
    { session },
  );
  if (!login.matchedCount)
    throw new RequestContractError(401, 'Session is unavailable');
  try {
    const verified = verifyAccessToken(token);
    if (
      verified.userId !== identity?.userId ||
      verified.role !== identity?.role
    )
      throw missing();
  } catch {
    throw new RequestContractError(401, 'Session is unavailable');
  }
  return actorFor(identity, permission, session);
}
// Resolve a civil school time without relying on the host's local timezone.
// Round-trip validation fails closed for non-existent DST instants.
export function lessonInstant(date: string, time: string): Date {
  const target = Date.parse(date + 'T' + time + ':00Z');
  let result = target;
  for (let i = 0; i < 4; i++) {
    const local = schoolDateTime(new Date(result));
    result += target - Date.parse(local.date + 'T' + local.time + ':00Z');
  }
  const local = schoolDateTime(new Date(result));
  if (local.date !== date || local.time !== time) throw conflict();
  return new Date(result);
}
function windowFor(start: Date, end: Date) {
  if (
    end <= start ||
    Date.now() < start.getTime() - START_EARLY_MS ||
    Date.now() >= end.getTime()
  )
    throw conflict();
}
async function catalog(
  session: ClientSession,
  period: TeacherPeriodDTO,
  branchId: string,
) {
  const context = await requireClassSubject(
    branchId,
    period.classId,
    period.subjectId,
    session,
  );
  await fence(session, AcademicPeriod.collection.name, context.period._id);
  await fence(session, ClassSubject.collection.name, context.mapping._id);
  if (
    period.date < context.period.startDate ||
    period.date >= context.period.endDate
  )
    throw missing();
  return context.period;
}
async function studentAccess(
  identity: JwtPayload | undefined,
  row: Lesson,
  session?: ClientSession,
  historical = false,
) {
  const actor = await actorFor(
    identity,
    historical ? PERMISSIONS.LIVE_LESSON_VIEW : PERMISSIONS.LIVE_LESSON_JOIN,
    session,
  );
  if (actor.role !== 'student' || !same(actor.branchId, row.branchId))
    throw missing();
  const student = await Student.findOne({ isActive: true })
    .where('userId')
    .equals(String(actor._id))
    .where('branchId')
    .equals(String(row.branchId))
    .session(session ?? null);
  if (!student) throw missing();
  if (session) await fence(session, Student.collection.name, student._id);
  const enrollment = await StudentEnrollment.findOne({
    studentId: student._id,
    branchId: row.branchId,
    academicPeriodId: row.academicPeriodId,
    classId: row.classId,
    sectionId: row.sectionId,
    ...(historical
      ? {
          effectiveFrom: { $lte: row.scheduledStart },
          $or: [
            { status: 'active', effectiveTo: null },
            {
              status: { $in: ['transferred', 'promoted', 'withdrawn'] },
              effectiveTo: { $gt: row.scheduledStart },
            },
          ],
        }
      : { ...activeEnrollmentFilter(), effectiveTo: null }),
  }).session(session ?? null);
  // No legacy compatibility path: explicit enrollment migration is required.
  if (!enrollment) throw missing();
  if (session)
    await fence(session, StudentEnrollment.collection.name, enrollment._id);
  return actor;
}
async function load(id: unknown, session?: ClientSession) {
  const row = await LiveLessonSession.findById(
    objectIdField(id, 'live lesson ID'),
  ).session(session ?? null);
  if (!row) throw missing();
  return row;
}
function matches(
  row: Lesson,
  period: TeacherPeriodDTO,
  branchId: string,
  academicPeriodId: unknown,
  hostId: string,
) {
  if (
    !same(row.branchId, branchId) ||
    !same(row.academicPeriodId, academicPeriodId) ||
    !same(row.timetableVersionId, period.approvedVersion.versionId) ||
    !same(row.classId, period.classId) ||
    !same(row.sectionId, period.sectionId) ||
    !same(row.subjectId, period.subjectId) ||
    !same(row.hostTeacherId, hostId) ||
    !same(row.substituteId, period.substituteId) ||
    row.scheduledStart.getTime() !==
      lessonInstant(period.date, period.startTime).getTime() ||
    row.scheduledEnd.getTime() !==
      lessonInstant(period.date, period.endTime).getTime()
  )
    throw missing();
}
async function transition(
  row: Lesson,
  status: 'starting' | 'live' | 'ended',
  actorId: string,
  session: ClientSession,
) {
  const allowed =
    status === 'starting'
      ? row.status === 'scheduled'
      : status === 'live'
      ? row.status === 'starting'
      : row.status === 'live';
  if (!allowed) throw conflict();
  row.status = status;
  row.revision += 1;
  const at = new Date();
  if (status === 'live') row.startedAt = at;
  if (status === 'ended') row.endedAt = at;
  row.history.push({
    status,
    at,
    actorId: new mongoose.Types.ObjectId(actorId),
  });
  await row.save({ session });
}

export function createLiveLessonService(
  providerFactory: () => RtcProvider = rtcProvider,
  kick: (roomId: string, userId: string, until: Date) => Promise<void> = (
    room,
    user,
    until,
  ) => kickZegoUser(room, user, fetch, until),
) {
  const credential = (
    provider: RtcProvider,
    row: Lesson,
    actorId: string,
    role: RtcRole,
  ) => {
    if (provider.name !== row.provider)
      throw new RequestContractError(
        503,
        'Live lesson provider is unavailable',
      );
    windowFor(row.scheduledStart, row.scheduledEnd);
    try {
      return provider.issueCredential({
        sessionId: String(row._id),
        roomId: row.providerRoomId,
        actorId,
        role,
        expiresAt: row.scheduledEnd,
      });
    } catch (error) {
      if (error instanceof RequestContractError) throw error;
      throw new RequestContractError(
        503,
        'Live lesson credential issuance failed',
      );
    }
  };
  // Every control-plane operation shares occurrence/catalog, user/login,
  // enrollment and lesson fences with credential issuance and End.
  const classroom = async <T>(
    identity: JwtPayload | undefined,
    token: LoginCredential,
    id: unknown,
    action: (
      row: Lesson,
      actor: Awaited<ReturnType<typeof actorFor>>,
      session: ClientSession,
    ) => Promise<T>,
  ) => {
    const initial = await load(id);
    const actor = await actorFor(
      identity,
      identity?.role === 'teacher'
        ? PERMISSIONS.LIVE_LESSON_START
        : PERMISSIONS.LIVE_LESSON_JOIN,
    );
    if (actor.role === 'student') await studentAccess(identity, initial);
    const host: JwtPayload =
      actor.role === 'teacher'
        ? identity!
        : { userId: String(initial.hostTeacherId), role: 'teacher' };
    return mutateOccurrence(
      host,
      String(initial.periodId),
      initial.date,
      PERMISSIONS.LIVE_LESSON_START,
      async (session, period, branchId) => {
        const current = await loginFence(
          session,
          identity,
          token,
          actor.role === 'teacher'
            ? PERMISSIONS.LIVE_LESSON_START
            : PERMISSIONS.LIVE_LESSON_JOIN,
        );
        const academic = await catalog(session, period, branchId);
        const row = await load(id, session);
        await fence(session, LiveLessonSession.collection.name, row._id);
        matches(row, period, branchId, academic._id, host.userId);
        if (row.status !== 'live') throw conflict();
        windowFor(row.scheduledStart, row.scheduledEnd);
        if (current.role === 'student')
          await studentAccess(identity, row, session);
        return action(row, current, session);
      },
    );
  };
  const service = {
    async requestAdmission(
      identity: JwtPayload | undefined,
      token: string,
      id: unknown,
      connection: unknown,
    ) {
      const key = connectionKey(connection);
      return classroom(identity, token, id, async (lesson, actor, session) => {
        if (actor.role !== 'student') throw missing();
        let row = await presenceFor(lesson, String(actor._id), session);
        if (!row) {
          if (
            (await LiveLessonPresence.countDocuments({
              liveLessonSessionId: lesson._id,
            }).session(session)) >= 500
          )
            throw new RequestContractError(
              409,
              'Classroom participant capacity reached',
            );
          row = new LiveLessonPresence({
            liveLessonSessionId: lesson._id,
            branchId: lesson.branchId,
            actorId: actor._id,
            role: 'participant',
            admission: 'waiting',
            requestedAt: new Date(Date.now()),
          });
          event(row, 'joinRequested', String(actor._id));
        }
        if (row.admission === 'removed' || row.admission === 'rejected')
          return { session: dto(lesson), participant: presenceDTO(row, 'You') };
        if (
          row.admission === 'left' &&
          row.leaseUntil &&
          row.leaseUntil.getTime() > Date.now()
        )
          throw conflict();
        claim(row, token, key);
        if (row.admission === 'left') {
          row.admission = 'waiting';
          row.requestedAt = new Date(Date.now());
          row.enforcement = 'none';
          event(row, 'joinRequested', String(actor._id));
        }
        row.lastSeenAt = new Date(Date.now());
        await row.save({ session });
        return { session: dto(lesson), participant: presenceDTO(row, 'You') };
      });
    },
    async classroom(
      identity: JwtPayload | undefined,
      token: string,
      id: unknown,
      connection: unknown,
      state: unknown = 'connected',
    ) {
      const key = connectionKey(connection);
      if (
        typeof state !== 'string' ||
        !['connected', 'reconnecting', 'disconnected', 'left'].includes(state)
      )
        throw new RequestContractError(400, 'Invalid classroom presence state');
      return classroom(identity, token, id, async (lesson, actor, session) => {
        const own = await presenceFor(lesson, String(actor._id), session);
        if (!own) throw missing();
        if (!['removed', 'rejected'].includes(own.admission)) {
          claim(own, token, key);
          if (state === 'left') closePresence(own, String(actor._id));
          else {
            const next =
              own.admission === 'admitted' ? String(state) : 'disconnected';
            if (own.connectionState !== next) {
              if (next === 'connected' && own.firstJoinedAt) {
                own.reconnectCount++;
                event(own, 'reconnected', String(actor._id));
              } else
                event(
                  own,
                  next === 'connected' ? 'joined' : 'disconnected',
                  String(actor._id),
                );
              own.connectionState = next as typeof own.connectionState;
            }
            if (next === 'connected' && !own.firstJoinedAt)
              own.firstJoinedAt = new Date(Date.now());
            own.lastSeenAt = new Date(Date.now());
          }
          await own.save({ session });
        }
        const rows =
          actor.role === 'teacher'
            ? await LiveLessonPresence.find({ liveLessonSessionId: lesson._id })
                .limit(500)
                .session(session)
            : [own];
        const users = await User.find()
          .where('_id')
          .in(rows.map(r => String(r.actorId)))
          .where('branchId')
          .equals(String(lesson.branchId))
          .select('_id fullName')
          .session(session);
        return {
          session: dto(lesson),
          participant: presenceDTO(own, 'You'),
          participants: rows.map(r =>
            presenceDTO(
              r,
              users.find(u => same(u._id, r.actorId))?.fullName ??
                'Classroom participant',
            ),
          ),
          capabilities: {
            forceMute: false,
            studentPublishing: false,
            providerRemoval: true,
          },
        };
      });
    },
    async moderate(
      identity: JwtPayload | undefined,
      token: string,
      id: unknown,
      target: unknown,
      operation: unknown,
    ) {
      const began = Date.now();
      if (
        typeof operation !== 'string' ||
        !['admit', 'reject', 'remove', 'lower-hand'].includes(operation)
      )
        throw new RequestContractError(400, 'Invalid classroom action');
      const targetId = objectIdField(target, 'participant ID');
      const result = await classroom(
        identity,
        token,
        id,
        async (lesson, actor, session) => {
          if (actor.role !== 'teacher') throw missing();
          const row = await LiveLessonPresence.findOne({
            _id: targetId,
            liveLessonSessionId: lesson._id,
            role: 'participant',
          }).session(session);
          if (!row) throw missing();
          const desired =
            operation === 'admit'
              ? 'admitted'
              : operation === 'reject'
              ? 'rejected'
              : 'removed';
          if (operation === 'lower-hand') {
            if (row.handRaised) {
              rate(row);
              row.handRaised = false;
              event(row, 'handLowered', String(actor._id));
            }
          } else if (row.admission !== desired) {
            if (operation === 'remove') {
              if (row.admission !== 'admitted') throw conflict();
              closePresence(row, String(actor._id), true);
            } else {
              if (row.admission !== 'waiting') throw conflict();
              await studentAccess(
                { userId: String(row.actorId), role: 'student' },
                lesson,
                session,
              );
              rate(row);
              row.admission = desired;
              if (desired === 'admitted') row.admittedAt = new Date(Date.now());
              event(row, desired, String(actor._id));
            }
          }
          await row.save({ session });
          return { participant: presenceDTO(row, 'Classroom participant') };
        },
      );
      // Durable enforcement is committed first. A retry can safely drain the same job.
      if (operation === 'remove') await service.enforceRemoval(targetId);
      console.info(
        JSON.stringify({
          operation: 'live.classroom.' + String(operation),
          liveLessonSessionId: String(id),
          role: 'host',
          latencyMs: Date.now() - began,
          timestamp: new Date().toISOString(),
        }),
      );
      return result;
    },
    async hand(
      identity: JwtPayload | undefined,
      token: string,
      id: unknown,
      connection: unknown,
      raised: unknown,
    ) {
      if (typeof raised !== 'boolean')
        throw new RequestContractError(400, 'Invalid hand state');
      const key = connectionKey(connection);
      return classroom(identity, token, id, async (lesson, actor, session) => {
        if (actor.role !== 'student') throw missing();
        const row = await presenceFor(lesson, String(actor._id), session);
        if (!row || row.admission !== 'admitted') throw missing();
        claim(row, token, key);
        if (row.handRaised !== raised) {
          rate(row);
          row.handRaised = raised;
          event(row, raised ? 'handRaised' : 'handLowered', String(actor._id));
        }
        await row.save({ session });
        return { participant: presenceDTO(row, 'You') };
      });
    },
    async enforceRemoval(id: unknown) {
      // DB claim, not a process-local mutex. A crashed worker's claim expires.
      const row = await LiveLessonPresence.findOneAndUpdate(
        {
          _id: id,
          enforcement: { $in: ['pending', 'failed'] },
          enforcementAfter: { $lte: new Date(Date.now()) },
        },
        {
          $set: { enforcementAfter: new Date(Date.now() + 15000) },
          $inc: { enforcementAttempts: 1 },
        },
        { returnDocument: 'after' },
      );
      if (!row) return;
      const lesson = await LiveLessonSession.findById(row.liveLessonSessionId);
      let enforcement: 'confirmed' | 'failed' | 'expired' = 'expired';
      if (
        lesson &&
        row.providerUserId &&
        row.credentialUntil &&
        row.credentialUntil.getTime() > Date.now()
      ) {
        try {
          if (lesson.provider !== 'zegocloud') throw new Error('provider');
          await kick(
            lesson.providerRoomId,
            row.providerUserId,
            row.credentialUntil,
          );
          enforcement = 'confirmed';
        } catch {
          enforcement = 'failed';
        }
      }
      await LiveLessonPresence.updateOne(
        {
          _id: row._id,
          revision: row.revision,
          enforcementAttempts: row.enforcementAttempts,
          enforcement: { $in: ['pending', 'failed'] },
        },
        { $set: { enforcement } },
      );
    },
    async maintainClassrooms() {
      const active = await LiveLessonPresence.find({
        admission: 'admitted',
        $or: [
          { role: 'host' },
          { credentialUntil: { $gt: new Date(Date.now()) } },
        ],
      })
        .sort({ checkedAt: 1 })
        .limit(100);
      for (const row of active) {
        await LiveLessonPresence.updateOne(
          { _id: row._id },
          { $set: { checkedAt: new Date(Date.now()) } },
        );
        try {
          let login: {token: LoginCredential} | undefined;
          if (process.env.INTEGRATED_STAFF_ENABLED === 'true') {
            // Only an internal digest enters this path; HTTP callers always supply raw bearer strings.
            if (!row.loginHash) throw new RequestContractError(401, 'Session unavailable');
            login = {token: {hash: row.loginHash}};
          } else {
            const logins = await Session.find({userId: row.actorId, isRevoked: false}).select('token');
            login = logins.find(s => createHash('sha256').update(s.token).digest('hex') === row.loginHash);
          }
          if (!login)
            throw new RequestContractError(401, 'Session unavailable');
          // Internal authority check reuses the exact issuance transaction fences.
          await classroom(
            {
              userId: String(row.actorId),
              role: row.role === 'host' ? 'teacher' : 'student',
            },
            login.token,
            String(row.liveLessonSessionId),
            async () => undefined,
          );
        } catch (error) {
          if (
            !(error instanceof RequestContractError) ||
            ![401, 403, 404, 409].includes(error.status)
          )
            continue;
          await withAcademicCatalogLock(String(row.branchId), async session => {
            const current = await LiveLessonPresence.findById(row._id).session(
              session,
            );
            if (!current || current.revision !== row.revision) return;
            closePresence(current, String(current.actorId), true);
            await current.save({ session });
            if (current.role === 'host') {
              const lesson = await LiveLessonSession.findById(
                current.liveLessonSessionId,
              ).session(session);
              if (lesson?.status === 'live') {
                await transition(
                  lesson,
                  'ended',
                  String(current.actorId),
                  session,
                );
                const peers = await LiveLessonPresence.find({
                  liveLessonSessionId: lesson._id,
                }).session(session);
                for (const peer of peers) {
                  closePresence(peer, String(current.actorId));
                  await peer.save({ session });
                }
              }
            }
          });
        }
      }
      const jobs = await LiveLessonPresence.find({
        enforcement: { $in: ['pending', 'failed'] },
        enforcementAfter: { $lte: new Date(Date.now()) },
      }).limit(50);
      for (const row of jobs) await service.enforceRemoval(row._id);
      // Whitelisted aggregate operational hook: no credentials or Student PII.
      if (jobs.length)
        console.info(
          JSON.stringify({
            operation: 'live.classroom.enforcement',
            jobs: jobs.length,
            timestamp: new Date().toISOString(),
          }),
        );
    },
    async previewConfig(
      identity: JwtPayload | undefined,
      periodId: unknown,
      date: unknown,
    ) {
      const actor = await actorFor(identity, PERMISSIONS.LIVE_LESSON_START);
      if (actor.role !== 'teacher') throw missing();
      return mutateOccurrence(
        identity,
        periodId,
        date,
        PERMISSIONS.LIVE_LESSON_START,
        async (session, period, branchId) => {
          await catalog(session, period, branchId);
          return providerFactory().publicConfig();
        },
      );
    },
    async available(identity: JwtPayload | undefined) {
      const actor = await actorFor(identity, PERMISSIONS.LIVE_LESSON_JOIN);
      if (actor.role !== 'student' || !actor.branchId) throw missing();
      await requireActiveAcademicBranch(String(actor.branchId));
      const profile = await Student.findOne({ isActive: true })
        .where('userId')
        .equals(String(actor._id))
        .where('branchId')
        .equals(String(actor.branchId))
        .read('primary');
      if (!profile) throw missing();
      const enrollment = await currentEnrollment(profile._id, actor.branchId);
      if (!enrollment) return { sessions: [] };
      const now = new Date();
      const rows = await LiveLessonSession.find({
        branchId: String(actor.branchId),
        academicPeriodId: String(enrollment.academicPeriodId),
        classId: String(enrollment.classId),
        sectionId: String(enrollment.sectionId),
        status: 'live',
        scheduledEnd: { $gt: now },
        scheduledStart: { $lte: new Date(now.getTime() + START_EARLY_MS) },
      })
        .read('primary')
        .sort({ scheduledStart: -1 })
        .limit(20);
      const sessions = [];
      for (const row of rows) {
        try {
          await studentAccess(identity, row);
        } catch (error) {
          if (error instanceof RequestContractError && error.status === 404)
            continue;
          throw error;
        }
        const [cls, section, subject] = await Promise.all([
          SchoolClass.findById(String(row.classId)).select('name').lean(),
          Section.findById(String(row.sectionId)).select('name').lean(),
          Subject.findById(String(row.subjectId)).select('name').lean(),
        ]);
        sessions.push({
          ...dto(row),
          className: cls?.name ?? 'Class',
          sectionName: section?.name ?? '',
          subjectName: subject?.name ?? 'Lesson',
        });
      }
      // Discovery is a hint, never a credential. Join revalidates all current
      // operational authority under the original T-PR15A transaction fences.
      return { sessions };
    },
    async start(
      identity: JwtPayload | undefined,
      token: string,
      periodId: unknown,
      date: unknown,
      connectionId: unknown = 'internal-connection',
    ) {
      const key = connectionKey(connectionId);
      const actor = await actorFor(identity, PERMISSIONS.LIVE_LESSON_START);
      if (actor.role !== 'teacher') throw missing();
      return mutateOccurrence(
        identity,
        periodId,
        date,
        PERMISSIONS.LIVE_LESSON_START,
        async (session, period, branchId) => {
          const current = await loginFence(
            session,
            identity,
            token,
            PERMISSIONS.LIVE_LESSON_START,
          );
          const academic = await catalog(session, period, branchId);
          const start = lessonInstant(period.date, period.startTime),
            end = lessonInstant(period.date, period.endTime);
          windowFor(start, end);
          const provider = providerFactory();
          let row = await LiveLessonSession.findOne({
            periodId: period.periodId,
            date: period.date,
          }).session(session);
          if (!row) {
            const scheduled = await TimetablePeriod.findById(
              period.periodId,
            ).session(session);
            if (!scheduled) throw missing();
            const id = new mongoose.Types.ObjectId();
            [row] = await LiveLessonSession.create(
              [
                {
                  _id: id,
                  branchId,
                  academicPeriodId: academic._id,
                  timetableVersionId: period.approvedVersion.versionId,
                  periodId: period.periodId,
                  date: period.date,
                  classId: period.classId,
                  sectionId: period.sectionId,
                  subjectId: period.subjectId,
                  scheduledTeacherId: scheduled.teacherId,
                  hostTeacherId: current._id,
                  substituteId: period.substituteId ?? undefined,
                  scheduledStart: start,
                  scheduledEnd: end,
                  provider: provider.name,
                  providerRoomId: provider.roomId(String(id)),
                  status: 'scheduled',
                  history: [
                    {
                      status: 'scheduled',
                      at: new Date(),
                      actorId: current._id,
                    },
                  ],
                },
              ],
              { session },
            );
          }
          matches(row, period, branchId, academic._id, String(current._id));
          if (!['scheduled', 'live'].includes(row.status)) throw conflict();
          const connection = credential(
            provider,
            row,
            String(current._id),
            'host',
          );
          if (row.status === 'scheduled') {
            await transition(row, 'starting', String(current._id), session);
            await transition(row, 'live', String(current._id), session);
          }
          let presence = await presenceFor(row, String(current._id), session);
          if (!presence)
            presence = new LiveLessonPresence({
              liveLessonSessionId: row._id,
              branchId,
              actorId: current._id,
              role: 'host',
              admission: 'admitted',
              requestedAt: new Date(Date.now()),
            });
          claim(presence, token, key);
          if (
            presence.admission === 'left' &&
            presence.credentialUntil &&
            presence.credentialUntil.getTime() + 5000 > Date.now()
          )
            throw conflict();
          rate(presence, true);
          presence.admission = 'admitted';
          presence.providerUserId = connection.userId;
          presence.credentialUntil = new Date(connection.expiresAt);
          presence.leaseUntil = new Date(
            Date.parse(connection.expiresAt) + 5000,
          );
          presence.enforcement = 'none';
          presence.revision++;
          await presence.save({ session });
          return { session: dto(row), connection };
        },
      );
    },
    async join(
      identity: JwtPayload | undefined,
      token: string,
      id: unknown,
      connectionId: unknown = 'internal-connection',
    ) {
      const key = connectionKey(connectionId);
      const initial = await load(id);
      // Resolve participant first: unauthorized requests never reach provider code.
      await studentAccess(identity, initial);
      const host: JwtPayload = {
        userId: String(initial.hostTeacherId),
        role: 'teacher',
      };
      return mutateOccurrence(
        host,
        String(initial.periodId),
        initial.date,
        PERMISSIONS.LIVE_LESSON_START,
        async (session, period, branchId) => {
          await loginFence(
            session,
            identity,
            token,
            PERMISSIONS.LIVE_LESSON_JOIN,
          );
          const academic = await catalog(session, period, branchId);
          const row = await load(id, session);
          await fence(session, LiveLessonSession.collection.name, row._id);
          matches(row, period, branchId, academic._id, host.userId);
          if (row.status !== 'live') throw conflict();
          const actor = await studentAccess(identity, row, session);
          const presence = await presenceFor(row, String(actor._id), session);
          if (!presence || presence.admission !== 'admitted')
            throw new RequestContractError(
              403,
              'Teacher admission is required',
            );
          claim(presence, token, key);
          rate(presence, true);
          const connection = credential(
            providerFactory(),
            row,
            String(actor._id),
            'participant',
          );
          presence.providerUserId = connection.userId;
          presence.credentialUntil = new Date(connection.expiresAt);
          presence.leaseUntil = new Date(
            Date.parse(connection.expiresAt) + 5000,
          );
          presence.enforcement = 'none';
          presence.revision++;
          await presence.save({ session });
          return {
            session: dto(row),
            connection,
          };
        },
      );
    },
    async end(identity: JwtPayload | undefined, token: string, id: unknown) {
      const initial = await load(id);
      return withAcademicCatalogLock(
        String(initial.branchId),
        async session => {
          const actor = await loginFence(
            session,
            identity,
            token,
            PERMISSIONS.LIVE_LESSON_END,
          );
          const row = await load(id, session);
          if (
            actor.role !== 'teacher' ||
            !same(actor.branchId, row.branchId) ||
            !same(actor._id, row.hostTeacherId)
          )
            throw missing();
          if (row.status !== 'ended')
            await transition(row, 'ended', String(actor._id), session);
          const participants = await LiveLessonPresence.find({
            liveLessonSessionId: row._id,
          }).session(session);
          for (const participant of participants) {
            closePresence(participant, String(actor._id));
            await participant.save({ session });
          }
          return dto(row);
        },
      );
    },
    async read(identity: JwtPayload | undefined, id: unknown) {
      const actor = await actorFor(identity, PERMISSIONS.LIVE_LESSON_VIEW);
      const row = await load(id);
      if (!same(actor.branchId, row.branchId)) throw missing();
      if (actor.role === 'teacher') {
        if (
          !same(actor._id, row.hostTeacherId) &&
          !same(actor._id, row.scheduledTeacherId)
        )
          throw missing();
      } else await studentAccess(identity, row, undefined, true);
      return { ...dto(row), timezone: schoolTimezone() };
    },
  };
  return service;
}
export const liveLessonService = createLiveLessonService();
