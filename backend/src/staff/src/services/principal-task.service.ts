import {type SessionAuthority} from './authenticated-session.service';
import {Types} from 'mongoose';
import PrincipalTask, {IPrincipalTask, PRINCIPAL_TASK_PRIORITIES, PRINCIPAL_TASK_STATUSES} from '../models/principalTask';
import {principalWriteActor, principalWriteAssignee, PRINCIPAL_WRITE_ASSIGNEE_ROLES, withPrincipalWriteAuthority, fencePrincipalWriteUser} from './principal-write-access.service';
import {enumField, validDate, objectIdField, RequestContractError, textField} from '../utils/request-validation';
import User from '../models/user';
import {PERMISSIONS} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';

export const getBranchPrincipalTasks = async (branchId: string, filters: {status?: unknown; priority?: unknown; search?: unknown} = {}): Promise<IPrincipalTask[]> => {
  objectIdField(branchId, 'branch ID');
  const query = PrincipalTask.find().where('branchId').equals(branchId);
  if (filters.status !== undefined) {
    const status = enumField(filters.status, 'task status', Object.values(PRINCIPAL_TASK_STATUSES));
    if (status === 'pending') query.and([{$or: [{status}, {status: {$exists: false}}]}]);
    else query.where('status').equals(status);
  }
  if (filters.priority !== undefined) {
    const priority = enumField(filters.priority, 'task priority', Object.values(PRINCIPAL_TASK_PRIORITIES));
    if (priority === 'normal') query.and([{$or: [{priority}, {priority: {$exists: false}}]}]);
    else query.where('priority').equals(priority);
  }
  if (filters.search !== undefined) {
    const search = textField(filters.search, 'task search', 150);
    query.where('title').regex(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  return query.sort({createdAt: -1});
};

export const getEligibleTaskAssignees = async (branchId: string, actorId: string) => {
  await principalWriteActor(actorId, branchId);
  const users = await User.find().where('branchId').equals(branchId)
    .where('isActive').equals(true).where('role').in([...PRINCIPAL_WRITE_ASSIGNEE_ROLES])
    .select('_id fullName role').sort({fullName: 1, _id: 1}).lean();
  const eligible = [];
  for (const user of users) {
    try {
      // Creation uses this same policy and independently rechecks the selection.
      await principalWriteAssignee(user._id.toString(), branchId);
      eligible.push({_id: user._id.toString(), fullName: user.fullName, role: user.role});
    } catch (error) {
      if (!(error instanceof RequestContractError)) throw error;
    }
  }
  return eligible;
};

export const canManagePrincipalTasks = () => ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_TASKS_MANAGE);

// Add branch-scoped display identities and action capabilities without changing
// stored task fields, legacy defaults, or the existing list/detail envelopes.
export const serializePrincipalTasks = async (tasks: IPrincipalTask[], actorId: string) => {
  if (!tasks.length) return [];
  const ids = tasks.flatMap(task => [task.assignedTo, task.createdBy, ...task.history.map(entry => entry.performedBy)]);
  const users = await User.find().where('_id').in(ids).where('branchId').equals(tasks[0].branchId)
    .select('_id fullName role').lean();
  const identities = new Map(users.map(user => [String(user._id), {_id: String(user._id), fullName: user.fullName, role: user.role}]));
  const display = (id: unknown) => identities.get(String(id)) ?? null;
  return tasks.map(task => {
  const active = ['pending', 'in_progress'].includes(task.status);
  const ownsTask = String(task.createdBy) === actorId || String(task.assignedTo) === actorId;
  const allowedActions: PrincipalTaskAction[] = canManagePrincipalTasks() && ownsTask && active
    ? [...(task.status === 'pending' ? ['start' as const] : []), 'complete', 'cancel'] : [];
  const publicTask = task.toObject();
  return {
    ...publicTask, assignee: display(task.assignedTo), creator: display(task.createdBy),
    // Preserve the existing public history contract; never spread subdocument internals.
    history: publicTask.history.map((entry: IPrincipalTask['history'][number] & {_id?: Types.ObjectId}) => ({
      ...(entry._id === undefined ? {} : {_id: entry._id}),
      action: entry.action, performedBy: entry.performedBy, createdAt: entry.createdAt,
      performer: display(entry.performedBy),
    })),
    capabilities: {allowedActions},
  };
  });
};

export const serializePrincipalTask = async (task: IPrincipalTask, actorId: string) =>
  (await serializePrincipalTasks([task], actorId))[0];

export const getPrincipalTaskById = async (taskId: string, branchId: string): Promise<IPrincipalTask> => {
  objectIdField(taskId, 'task ID');
  objectIdField(branchId, 'branch ID');
  const task = await PrincipalTask.findById(taskId).where('branchId').equals(branchId);
  if (!task) throw new RequestContractError(404, 'Principal task not found');
  return task;
};

export interface CreatePrincipalTaskInput {
  branchId: string; actorId: string; token?: SessionAuthority; title: string; description?: string;
  priority?: string; assignedTo: string; dueDate?: Date;
}

export const createPrincipalTask = async (data: CreatePrincipalTaskInput): Promise<IPrincipalTask> => {
  const title = textField(data.title, 'task title', 150, 2);
  const description = data.description === undefined ? undefined : textField(data.description, 'task description', 2000);
  const priority = data.priority === undefined ? undefined : enumField(data.priority, 'task priority', Object.values(PRINCIPAL_TASK_PRIORITIES));
  const dueDate = data.dueDate === undefined ? undefined : validDate(data.dueDate, 'Due date');
  const actor = await principalWriteActor(data.actorId, data.branchId);
  const assignee = await principalWriteAssignee(data.assignedTo, data.branchId);
  // Explicit fields only: model validation/defaults/timestamps now run on save.
  return withPrincipalWriteAuthority(data, PERMISSIONS.PRINCIPAL_TASKS_MANAGE, async session => new PrincipalTask({
    branchId: new Types.ObjectId(data.branchId), createdBy: actor._id,
    assignedTo: assignee._id, title, description, priority, dueDate,
  }).save({session}), session => fencePrincipalWriteUser(String(assignee._id), data.branchId, PRINCIPAL_WRITE_ASSIGNEE_ROLES, session));
};

export type PrincipalTaskAction = 'start' | 'complete' | 'cancel';
export interface PrincipalTaskActionInput {
  taskId: string; actorId: string; branchId: string; token?: SessionAuthority; action: PrincipalTaskAction;
}

export const processPrincipalTaskAction = async (data: PrincipalTaskActionInput): Promise<IPrincipalTask> => {
  objectIdField(data.taskId, 'task ID');
  const action = enumField(data.action, 'task action', ['start', 'complete', 'cancel'] as const);
  const actor = await principalWriteActor(data.actorId, data.branchId);
  const task = await PrincipalTask.findById(data.taskId).where('branchId').equals(data.branchId);
  if (!task) throw new RequestContractError(404, 'Principal task not found');
  if (String(task.assignedTo) !== actor._id.toString() && String(task.createdBy) !== actor._id.toString()) {
    throw new RequestContractError(403, 'Actor is not authorized for this task');
  }
  const active = [PRINCIPAL_TASK_STATUSES.PENDING, PRINCIPAL_TASK_STATUSES.IN_PROGRESS] as string[];
  if ((action === 'start' && task.status !== PRINCIPAL_TASK_STATUSES.PENDING) || !active.includes(task.status)) {
    throw new RequestContractError(409, 'Task action is not allowed in its current state');
  }
  const now = new Date();
  const status = action === 'start' ? 'in_progress' : action === 'complete' ? 'completed' : 'cancelled';
  return withPrincipalWriteAuthority(data, PERMISSIONS.PRINCIPAL_TASKS_MANAGE, async session => {
    const updated = await PrincipalTask.findOneAndUpdate({
      _id: task._id, branchId: task.branchId, status: task.status,
      assignedTo: task.assignedTo, createdBy: task.createdBy, updatedAt: task.updatedAt,
      __v: task.__v ?? {$exists: false},
    }, {
      $set: {status, ...(action === 'complete' ? {completedAt: now} : action === 'cancel' ? {completedAt: null} : {})},
      $push: {history: {action, performedBy: actor._id, createdAt: now}},
      $inc: {__v: 1},
    }, {returnDocument: 'after', runValidators: true, session});
    if (!updated) throw new RequestContractError(409, 'Principal task changed or was already processed');
    return updated;
  });
};
