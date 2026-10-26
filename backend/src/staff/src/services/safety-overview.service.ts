import {Types, type ClientSession} from 'mongoose';
import User from '../models/user';
import SafetyAlert, {ISafetyAlert, SAFETY_ALERT_TYPES, SAFETY_ALERT_STATUSES, SAFETY_ALERT_SEVERITIES} from '../models/safetyAlert';
import {PERMISSIONS} from '../constants/permissions';
import {ROLE_PERMISSIONS} from '../constants/rolePermissions';
import {enumField, objectIdField, RequestContractError} from '../utils/request-validation';
import {principalWriteActor, principalWriteAssignee, PRINCIPAL_WRITE_ASSIGNEE_ROLES} from './principal-write-access.service';

export const canManageSafetyAlerts = () => ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_SAFETY_MANAGE);
export const canViewSafetyAlerts = () => ROLE_PERMISSIONS.principal.includes(PERMISSIONS.PRINCIPAL_SAFETY_VIEW);
export type SafetyAction = 'assign' | 'resolve' | 'escalate';
export interface SafetyFilters {status?: unknown; severity?: unknown; type?: unknown}

// Whitelist public fields; never populate a user without checking its branch.
export const serializeSafetyAlerts = async (alerts: ISafetyAlert[], details: boolean, session?: ClientSession) => {
  if (!alerts.length) return [];
  const ids = alerts.flatMap(alert => [alert.assignedTo,
    ...(details ? (alert.history || []).flatMap(entry => [entry.performedBy, entry.assignedTo]) : []),
  ]).filter(Boolean);
  const users = await User.find().where('_id').in(ids).where('branchId').equals(alerts[0].branchId)
    .where('role').in([...PRINCIPAL_WRITE_ASSIGNEE_ROLES]).select('_id fullName role').session(session ?? null).lean();
  const identities = new Map(users.map(user => [String(user._id), {id: String(user._id), fullName: user.fullName, role: user.role}]));
  const display = (id: unknown) => identities.get(String(id)) ?? null;
  return alerts.map(alert => {
    const active = ['open', 'in_progress'].includes(alert.status);
    const allowedActions: SafetyAction[] = canManageSafetyAlerts() && active
      ? ['assign', 'resolve', ...(alert.status === 'in_progress' && alert.severity === 'critical' ? [] : ['escalate' as const])] : [];
    return {
      id: String(alert._id), type: alert.type, title: alert.title, severity: alert.severity, status: alert.status,
      assignedTo: display(alert.assignedTo), createdAt: alert.createdAt, updatedAt: alert.updatedAt,
      ...(details ? {
        description: alert.description, resolvedAt: alert.resolvedAt,
        history: (alert.history || []).map(entry => ({
          ...((entry as typeof entry & {_id?: unknown})._id ? {_id: String((entry as typeof entry & {_id: unknown})._id)} : {}),
          action: entry.action, createdAt: entry.createdAt,
          performer: display(entry.performedBy), assignedOfficer: display(entry.assignedTo),
        })),
      } : {}),
      capabilities: {allowedActions, canViewDetail: canViewSafetyAlerts()},
    };
  });
};

export type SafetyAlertDTO = Awaited<ReturnType<typeof serializeSafetyAlerts>>[number];

export const getSafetyOverview = async (branchId: string, filters: SafetyFilters, details: boolean) => {
  objectIdField(branchId, 'branch ID');
  const status = filters.status === undefined ? {$in: ['open', 'in_progress']}
    : enumField(filters.status, 'safety status', Object.values(SAFETY_ALERT_STATUSES));
  const severity = filters.severity === undefined ? undefined
    : enumField(filters.severity, 'safety severity', Object.values(SAFETY_ALERT_SEVERITIES));
  const type = filters.type === undefined ? undefined
    : enumField(filters.type, 'safety type', Object.values(SAFETY_ALERT_TYPES));
  // Preserve the existing raw-list legacy behavior, newest ordering and bound.
  const alerts = await SafetyAlert.collection.find({branchId: new Types.ObjectId(branchId), status,
    ...(severity ? {severity} : {}), ...(type ? {type} : {}),
  }).sort({createdAt: -1}).limit(100).toArray();
  return serializeSafetyAlerts(alerts as unknown as ISafetyAlert[], details);
};

export const getSafetyAlertById = async (alertId: string, branchId: string) => {
  objectIdField(alertId, 'alert ID');
  objectIdField(branchId, 'branch ID');
  const alert = await SafetyAlert.findById(alertId).where('branchId').equals(branchId);
  if (!alert) throw new RequestContractError(404, 'Safety alert not found');
  return alert;
};

export const getEligibleSafetyOfficers = async (alertId: string, branchId: string, actorId: string) => {
  await principalWriteActor(actorId, branchId);
  const alert = await getSafetyAlertById(alertId, branchId);
  if (!['open', 'in_progress'].includes(alert.status)) throw new RequestContractError(409, 'Safety alert is already resolved');
  const users = await User.find().where('branchId').equals(branchId).where('isActive').equals(true)
    .where('role').in([...PRINCIPAL_WRITE_ASSIGNEE_ROLES]).select('_id fullName role').sort({fullName: 1, _id: 1}).lean();
  const eligible = [];
  for (const user of users) {
    if (alert.status === 'in_progress' && String(alert.assignedTo) === String(user._id)) continue;
    try {
      await principalWriteAssignee(String(user._id), branchId);
      eligible.push({_id: String(user._id), fullName: user.fullName, role: user.role});
    } catch (error) {if (!(error instanceof RequestContractError)) throw error;}
  }
  return eligible;
};
