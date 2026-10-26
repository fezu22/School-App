import {enrollmentMembership} from './enrollment-membership.service';
import { createHash } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import Student from '../models/student';
import User from '../models/user';
import SchoolNotice from '../models/schoolNotice';
import {
  TeacherNotice,
  NoticeDelivery,
  NoticeOperation,
  ensureTeacherNoticeIndexes,
} from '../models/teacherNotice';
import { PERMISSIONS } from '../constants/permissions';
import { ROLE_PERMISSIONS } from '../constants/rolePermissions';
import {
  objectBody,
  objectIdField,
  textField,
  enumField,
  RequestContractError,
} from '../utils/request-validation';
import {
  communicationScope,
  communicationMissing,
  exactTuple,
  withTeacherCommunication,
  type Identity,
} from './teacher-communication-access.service';

const contextFields = ['classId', 'sectionId', 'subjectId', 'audienceType'];
const contentFields = [...contextFields, 'title', 'body', 'language'];
const contextInput = (body: Record<string, unknown>) => ({
  classId: objectIdField(body.classId, 'class ID'),
  sectionId: objectIdField(body.sectionId, 'section ID'),
  subjectId: objectIdField(body.subjectId, 'subject ID'),
  audienceType: enumField(body.audienceType, 'audience', [
    'class_students',
  ] as const),
});
const publicText = (value: unknown, name: string, max: number) => {
  const text = textField(value, name, max, 2);
  if (
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) ||
    /(?:\+?\d[\s().-]*){10,}/.test(text)
  )
    throw new RequestContractError(
      400,
      'Bulk notices must not include private email addresses or phone numbers',
    );
  return text;
};
const contentInput = (body: Record<string, unknown>) => ({
  ...contextInput(body),
  title: publicText(body.title, 'title', 150),
  body: publicText(body.body, 'body', 2000),
  language: enumField(body.language, 'language', ['en', 'ur'] as const),
});
const revisionInput = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new RequestContractError(400, 'Invalid revision');
  return value;
};
// Count/IDs only; no full Student or User profiles, contacts or admission data.
export const resolveNoticeRecipients = async (
  branchId: string,
  context: { classId: string; sectionId: string },
) =>
  Student.aggregate<{
    studentId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
  }>([
    ...enrollmentMembership(branchId, context.classId, context.sectionId),
    { $project: { _id: 1, userId: 1 } },
    {
      $lookup: {
        from: User.collection.name,
        localField: 'userId',
        foreignField: '_id',
        pipeline: [
          {
            $match: {
              branchId: new mongoose.Types.ObjectId(branchId),
              role: 'student',
              isActive: true,
            },
          },
          { $project: { _id: 1 } },
        ],
        as: 'identity',
      },
    },
    { $unwind: '$identity' },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, studentId: '$_id', userId: 1 } },
  ]).read('primary');
export const previewTeacherNotice = async (
  identity: Identity,
  body: unknown,
) => {
  const context = contextInput(objectBody(body, contextFields));
  const scope = await communicationScope(
    identity,
    PERMISSIONS.TEACHER_NOTICES_MANAGE,
  );
  const tuple = exactTuple(scope, context);
  const recipients = await resolveNoticeRecipients(scope.branchId, tuple);
  return {
    context: tuple,
    audienceType: context.audienceType,
    recipientCount: recipients.length,
    channel: 'school_app_internal' as const,
  };
};
type Notice = NonNullable<Awaited<ReturnType<typeof TeacherNotice.findOne>>>;
const noticeDTO = (notice: Notice, canEdit: boolean) => ({
  noticeId: String(notice._id),
  kind: 'class_notice' as const,
  title: notice.title,
  body: notice.body,
  language: notice.language,
  state: notice.state,
  revision: notice.revision,
  classId: String(notice.classId),
  sectionId: String(notice.sectionId),
  subjectId: String(notice.subjectId),
  audienceType: notice.audienceType,
  createdAt: notice.createdAt.toISOString(),
  updatedAt: notice.updatedAt.toISOString(),
  publishedAt: notice.publishedAt?.toISOString() ?? null,
  recipientCount: notice.recipientCount,
  channel: 'school_app_internal' as const,
  deliveryState:
    notice.state === 'published' ? ('accepted_internal' as const) : null,
  canEdit,
});
const editable = (
  notice: Notice,
  scope: Awaited<ReturnType<typeof communicationScope>>,
) =>
  notice.state === 'draft' &&
  String(notice.createdBy) === scope.actorId &&
  ROLE_PERMISSIONS.teacher.includes(PERMISSIONS.TEACHER_NOTICES_MANAGE) &&
  scope.tuples.some(
    t =>
      t.classId === String(notice.classId) &&
      t.sectionId === String(notice.sectionId) &&
      t.subjectId === String(notice.subjectId),
  );
const ownerNotice = async (identity: Identity, id: unknown) => {
  const scope = await communicationScope(
    identity,
    PERMISSIONS.TEACHER_NOTICES_MANAGE,
  );
  const notice = await TeacherNotice.findOne({
    _id: objectIdField(id, 'notice ID'),
    branchId: scope.branchId,
    createdBy: scope.actorId,
  }).read('primary');
  if (!notice) throw communicationMissing();
  return { scope, notice };
};
export const saveTeacherNotice = async (
  identity: Identity,
  token: string,
  body: unknown,
  id?: unknown,
) => {
  const input = objectBody(body, [
    ...contentFields,
    ...(id === undefined ? [] : ['revision']),
  ]);
  const content = contentInput(input);
  const scope = await communicationScope(
    identity,
    PERMISSIONS.TEACHER_NOTICES_MANAGE,
  );
  const tuple = exactTuple(scope, content);
  const noticeId =
    id === undefined
      ? new mongoose.Types.ObjectId().toString()
      : objectIdField(id, 'notice ID');
  const revision = id === undefined ? 0 : revisionInput(input.revision);
  return withTeacherCommunication(
    identity,
    token,
    PERMISSIONS.TEACHER_NOTICES_MANAGE,
    tuple,
    async (session, current) => {
      // An old draft's scope must also remain authorized when changing context.
      if (id !== undefined) {
        const old = await TeacherNotice.findOne({
          _id: noticeId,
          branchId: current.branchId,
          createdBy: current.actorId,
        }).session(session);
        if (!old) throw communicationMissing();
        exactTuple(current, old);
      }
      const notice =
        id === undefined
          ? (
              await TeacherNotice.create(
                [
                  {
                    _id: noticeId,
                    ...content,
                    branchId: current.branchId,
                    createdBy: current.actorId,
                  },
                ],
                { session },
              )
            )[0]
          : await TeacherNotice.findOneAndUpdate(
              {
                _id: noticeId,
                branchId: current.branchId,
                createdBy: current.actorId,
                state: 'draft',
                revision,
              },
              { $set: content, $inc: { revision: 1 } },
              { session, returnDocument: 'after', runValidators: true },
            );
      if (!notice)
        throw new RequestContractError(
          409,
          'Draft changed or was already published',
        );
      return noticeDTO(notice, true);
    },
  );
};
const lockRecipients = async (
  session: ClientSession,
  branchId: string,
  context: { classId: string; sectionId: string },
) => {
  const candidates = await Student.find()
    .where('branchId')
    .equals(branchId)
    .where('classId')
    .equals(context.classId)
    .where('sectionId')
    .equals(context.sectionId)
    .read('primary')
    .select('_id userId')
    .lean();
  for (const [collection, ids] of [
    [Student.collection.name, candidates.map(s => s._id)],
    [User.collection.name, candidates.map(s => s.userId)],
  ] as const) {
    if (ids.length)
      await mongoose.connection.collection(collection).bulkWrite(
        ids.map(_id => ({
          updateOne: { filter: { _id }, update: { $inc: { __v: 1 } } },
        })),
        { session },
      );
  }
  const current = await resolveNoticeRecipients(branchId, context);
  const locked = new Map(
    candidates.map(c => [String(c._id), String(c.userId)]),
  );
  if (current.some(r => locked.get(String(r.studentId)) !== String(r.userId)))
    throw new RequestContractError(409, 'Audience changed; preview and retry');
  return current;
};
export const sendTeacherNotice = async (
  identity: Identity,
  token: string,
  id: unknown,
  body: unknown,
) => {
  const input = objectBody(body, ['revision', 'clientOperationId']);
  const revision = revisionInput(input.revision);
  const operation = textField(
    input.clientOperationId,
    'client operation ID',
    80,
    16,
  );
  if (!/^[A-Za-z0-9_-]+$/.test(operation))
    throw new RequestContractError(400, 'Invalid client operation ID');
  const { scope, notice } = await ownerNotice(identity, id);
  const tuple = exactTuple(scope, notice);
  const payloadHash = createHash('sha256')
    .update(JSON.stringify({ noticeId: String(notice._id), revision }))
    .digest('hex');
  await ensureTeacherNoticeIndexes();
  return withTeacherCommunication(
    identity,
    token,
    PERMISSIONS.TEACHER_NOTICES_MANAGE,
    tuple,
    async (session, current) => {
      const key = { createdBy: current.actorId, clientOperationId: operation };
      const existing = await NoticeOperation.findOne(key).session(session);
      const fresh = await TeacherNotice.findOne({
        _id: notice._id,
        branchId: current.branchId,
        createdBy: current.actorId,
      }).session(session);
      if (!fresh) throw communicationMissing();
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new RequestContractError(
            409,
            'Operation ID was used with a different payload',
          );
        return noticeDTO(fresh, false);
      }
      if (fresh.state !== 'draft' || fresh.revision !== revision)
        throw new RequestContractError(
          409,
          'Draft changed or was already published',
        );
      exactTuple(current, fresh);
      // A concurrent draft edit can change context between the initial read and
      // transaction. Never publish a context whose assignment was not fenced.
      if (
        String(fresh.classId) !== tuple.classId ||
        String(fresh.sectionId) !== tuple.sectionId ||
        String(fresh.subjectId) !== tuple.subjectId
      )
        throw new RequestContractError(
          409,
          'Draft audience changed; preview again',
        );
      const recipients = await lockRecipients(session, current.branchId, tuple);
      if (!recipients.length)
        throw new RequestContractError(409, 'No current authorized recipients');
      const publishedAt = new Date();
      const published = await TeacherNotice.findOneAndUpdate(
        { _id: fresh._id, revision, state: 'draft' },
        {
          $set: {
            state: 'published',
            publishedAt,
            recipientCount: recipients.length,
            clientOperationId: operation,
          },
          $inc: { revision: 1 },
        },
        { session, returnDocument: 'after', runValidators: true },
      );
      if (!published) throw new RequestContractError(409, 'Draft changed');
      await NoticeDelivery.insertMany(
        recipients.map(r => ({
          branchId: current.branchId,
          noticeId: fresh._id,
          studentId: r.studentId,
          recipientUserId: r.userId,
          state: 'accepted_internal',
          acceptedAt: publishedAt,
        })),
        { session },
      );
      await NoticeOperation.create(
        [
          {
            ...key,
            branchId: current.branchId,
            noticeId: fresh._id,
            payloadHash,
          },
        ],
        { session },
      );
      return noticeDTO(published, false);
    },
  );
};
// Published class announcements are visible to Teachers with the exact current
// supervising tuple. Drafts/history are creator-only in their current branch.
const inboxQuery = (scope: Awaited<ReturnType<typeof communicationScope>>) => ({
  branchId: scope.branchId,
  $or: [
    { createdBy: scope.actorId },
    ...scope.tuples.map(t => ({
      state: 'published' as const,
      classId: t.classId,
      sectionId: t.sectionId,
      subjectId: t.subjectId,
    })),
  ],
});
const schoolQuery = (branchId: string) => ({
  branchId: new mongoose.Types.ObjectId(branchId),
  audienceRoles: 'teacher',
  status: 'published',
  $or: [
    { expiresAt: { $exists: false } },
    { expiresAt: null },
    { expiresAt: { $gt: new Date() } },
  ],
});
const schoolDTO = (notice: {
  _id: unknown;
  title: string;
  message: string;
  createdAt: Date;
  updatedAt?: Date;
  publishedAt?: Date;
}) => ({
  noticeId: String(notice._id),
  kind: 'school_notice' as const,
  title: notice.title,
  body: notice.message,
  language: null,
  state: 'published' as const,
  revision: null,
  classId: null,
  sectionId: null,
  subjectId: null,
  audienceType: 'branch_teachers' as const,
  createdAt: notice.createdAt.toISOString(),
  updatedAt: notice.updatedAt?.toISOString() ?? null,
  publishedAt: notice.publishedAt?.toISOString() ?? null,
  recipientCount: null,
  channel: 'school_app_internal' as const,
  deliveryState: null,
  canEdit: false,
});
export const getTeacherInbox = async (identity: Identity, offset = 0) => {
  const scope = await communicationScope(
    identity,
    PERMISSIONS.TEACHER_NOTICES_VIEW,
  );
  const query = inboxQuery(scope),
    school = schoolQuery(scope.branchId);
  const pipeline = [
    { $match: TeacherNotice.find(query).cast() },
    { $project: { _id: 1, kind: { $literal: 'class_notice' }, createdAt: 1 } },
    {
      $unionWith: {
        coll: SchoolNotice.collection.name,
        pipeline: [
          { $match: school },
          {
            $project: {
              _id: 1,
              kind: { $literal: 'school_notice' },
              createdAt: 1,
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 as const, _id: -1 as const } },
    { $skip: offset },
    { $limit: 50 },
  ];
  const [ids, ownCount, schoolCount] = await Promise.all([
    TeacherNotice.aggregate<{ _id: mongoose.Types.ObjectId; kind: string }>(
      pipeline,
    ).read('primary'),
    TeacherNotice.countDocuments(query).read('primary'),
    SchoolNotice.collection.countDocuments(school),
  ]);
  const [notices, schools] = await Promise.all([
    TeacherNotice.find({
      ...query,
      _id: { $in: ids.filter(i => i.kind === 'class_notice').map(i => i._id) },
    })
      .select(
        '_id title body language state revision classId sectionId subjectId audienceType createdAt updatedAt publishedAt recipientCount createdBy',
      )
      .read('primary'),
    SchoolNotice.collection
      .find(
        {
          ...school,
          _id: {
            $in: ids.filter(i => i.kind === 'school_notice').map(i => i._id),
          },
        },
        {
          projection: {
            _id: 1,
            title: 1,
            message: 1,
            createdAt: 1,
            updatedAt: 1,
            publishedAt: 1,
          },
        },
      )
      .toArray(),
  ]);
  const entries = new Map<
    string,
    ReturnType<typeof noticeDTO> | ReturnType<typeof schoolDTO>
  >();
  notices.forEach(n =>
    entries.set(String(n._id), noticeDTO(n, editable(n, scope))),
  );
  schools.forEach(n =>
    entries.set(
      String(n._id),
      schoolDTO(n as unknown as Parameters<typeof schoolDTO>[0]),
    ),
  );
  return {
    total: ownCount + schoolCount,
    items: ids.flatMap(i =>
      entries.has(String(i._id)) ? [entries.get(String(i._id))!] : [],
    ),
    nextOffset:
      offset + ids.length < ownCount + schoolCount ? offset + ids.length : null,
  };
};
// T-PR5 has priority on school notices, but no unread/acknowledgement domain.
// Reuse the Inbox audience/publication/expiry policy; never invent unread state.
export const getTeacherImportantNotice = async (identity: Identity) => {
  const scope = await communicationScope(
    identity,
    PERMISSIONS.TEACHER_NOTICES_VIEW,
  );
  const notice = await SchoolNotice.collection.findOne(
    {
      ...schoolQuery(scope.branchId),
      priority: { $in: ['high', 'urgent'] },
    },
    {
      projection: { _id: 1, title: 1 },
      sort: { priority: -1, publishedAt: -1, _id: -1 },
    },
  );
  return notice ? { noticeId: String(notice._id), title: notice.title } : null;
};
export const getTeacherNotice = async (identity: Identity, id: unknown) => {
  const scope = await communicationScope(
    identity,
    PERMISSIONS.TEACHER_NOTICES_VIEW,
  );
  const noticeId = objectIdField(id, 'notice ID');
  const notice = await TeacherNotice.findOne({
    ...inboxQuery(scope),
    _id: noticeId,
  }).read('primary');
  if (notice) return noticeDTO(notice, editable(notice, scope));
  const school = await SchoolNotice.collection.findOne(
    {
      ...schoolQuery(scope.branchId),
      _id: new mongoose.Types.ObjectId(noticeId),
    },
    {
      projection: {
        _id: 1,
        title: 1,
        message: 1,
        createdAt: 1,
        updatedAt: 1,
        publishedAt: 1,
      },
    },
  );
  if (!school) throw communicationMissing();
  return schoolDTO(school as unknown as Parameters<typeof schoolDTO>[0]);
};
