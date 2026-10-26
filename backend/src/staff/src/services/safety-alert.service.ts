import { Types } from 'mongoose';

import User from '../models/user';
import {
  principalWriteActor,
  principalWriteAssignee,
  withPrincipalWriteAuthority,
  fencePrincipalWriteUser,
  PRINCIPAL_WRITE_ASSIGNEE_ROLES,
} from './principal-write-access.service';
import {PERMISSIONS} from '../constants/permissions';
import {serializeSafetyAlerts, type SafetyAlertDTO} from './safety-overview.service';
import {
  enumField,
  objectIdField,
  RequestContractError,
} from '../utils/request-validation';
import SafetyAlert, {
  SAFETY_ALERT_SEVERITIES,
  SAFETY_ALERT_STATUSES,
  SAFETY_ALERT_TYPES,
  SafetyAlertType,
} from '../models/safetyAlert';

export interface SafetyAlertSummary {
  total: number;
  open: number;
  inProgress: number;
  critical: number;
  high: number;
  byType: Record<SafetyAlertType, number>;
}

const validateObjectId = (value: string, fieldName: string): void => {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
};

const createEmptyTypeCounts = (): Record<SafetyAlertType, number> => ({
  [SAFETY_ALERT_TYPES.MISSING_ATTENDANCE]: 0,
  [SAFETY_ALERT_TYPES.SUBSTITUTE_GAP]: 0,
  [SAFETY_ALERT_TYPES.BUS_EXCEPTION]: 0,
  [SAFETY_ALERT_TYPES.GATE_EXCEPTION]: 0,
  [SAFETY_ALERT_TYPES.INCIDENT]: 0,
  [SAFETY_ALERT_TYPES.HELPDESK]: 0,
  [SAFETY_ALERT_TYPES.BACKUP_FAILURE]: 0,
});

export const getBranchSafetyAlertSummary = async (
  branchId: string,
): Promise<SafetyAlertSummary> => {
  validateObjectId(branchId, 'branch ID');

  const branchObjectId = new Types.ObjectId(branchId);

  const summary = await SafetyAlert.aggregate<{
    _id: SafetyAlertType;
    count: number;
  }>([
    {
      $match: {
        branchId: branchObjectId,
        status: {
          $in: [SAFETY_ALERT_STATUSES.OPEN, SAFETY_ALERT_STATUSES.IN_PROGRESS],
        },
      },
    },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
      },
    },
  ]);

  const byType = createEmptyTypeCounts();

  for (const item of summary) {
    if (item._id in byType) {
      byType[item._id] = item.count;
    }
  }

  const [total, open, inProgress, critical, high] = await Promise.all([
    SafetyAlert.collection.countDocuments({
      branchId: branchObjectId,
      status: {
        $in: [SAFETY_ALERT_STATUSES.OPEN, SAFETY_ALERT_STATUSES.IN_PROGRESS],
      },
    }),

    SafetyAlert.collection.countDocuments({
      branchId: branchObjectId,
      status: SAFETY_ALERT_STATUSES.OPEN,
    }),

    SafetyAlert.collection.countDocuments({
      branchId: branchObjectId,
      status: SAFETY_ALERT_STATUSES.IN_PROGRESS,
    }),

    SafetyAlert.collection.countDocuments({
      branchId: branchObjectId,
      status: {
        $in: [SAFETY_ALERT_STATUSES.OPEN, SAFETY_ALERT_STATUSES.IN_PROGRESS],
      },
      severity: SAFETY_ALERT_SEVERITIES.CRITICAL,
    }),

    SafetyAlert.collection.countDocuments({
      branchId: branchObjectId,
      status: {
        $in: [SAFETY_ALERT_STATUSES.OPEN, SAFETY_ALERT_STATUSES.IN_PROGRESS],
      },
      severity: SAFETY_ALERT_SEVERITIES.HIGH,
    }),
  ]);

  return {
    total,
    open,
    inProgress,
    critical,
    high,
    byType,
  };
};

export const getBranchSafetyAlerts = async (
  branchId: string,
): Promise<
  Array<{
    id: string;
    type: SafetyAlertType;
    title: string;
    description?: string;
    severity: string;
    status: string;
    assignedTo?: {
      id: string;
      fullName: string;
      role: string;
    } | null;
    createdAt: Date;
    updatedAt: Date;
  }>
> => {
  validateObjectId(branchId, 'branch ID');

  const alerts = await SafetyAlert.collection
    .find({
      branchId: new Types.ObjectId(branchId),
      status: {
        $in: [SAFETY_ALERT_STATUSES.OPEN, SAFETY_ALERT_STATUSES.IN_PROGRESS],
      },
    })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  const assignedUserIds = Array.from(
    new Set(
      alerts
        .filter(
          (
            alert,
          ): alert is typeof alert & {
            assignedTo: Types.ObjectId;
          } => Boolean(alert.assignedTo),
        )
        .map(alert => alert.assignedTo.toString()),
    ),
  ).map(id => new Types.ObjectId(id));

  const assignedUsers: Array<{
    _id: Types.ObjectId;
    fullName: string;
    role: string;
  }> =
    assignedUserIds.length > 0
      ? await User.find({
          _id: { $in: assignedUserIds },
        })
          .where('branchId')
          .equals(branchId)
          .select('_id fullName role')
      : [];

  const assignedUserMap: Map<
    string,
    {
      id: string;
      fullName: string;
      role: string;
    }
  > = new Map(
    assignedUsers.map(
      (user: { _id: Types.ObjectId; fullName: string; role: string }) => [
        user._id.toString(),
        {
          id: user._id.toString(),
          fullName: user.fullName,
          role: user.role,
        },
      ],
    ),
  );

  return alerts.map(alert => ({
    id: alert._id.toString(),
    type: alert.type as SafetyAlertType,
    title: alert.title,
    ...(alert.description ? { description: alert.description } : {}),
    severity: alert.severity,
    status: alert.status,
    assignedTo: alert.assignedTo
      ? assignedUserMap.get(alert.assignedTo.toString()) ?? null
      : null,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  }));
};

export type SafetyAlertAction = 'assign' | 'resolve' | 'escalate';
export interface SafetyAlertActionInput {
  alertId: string;
  actorId: string;
  token?: string;
  branchId: string;
  action: SafetyAlertAction;
  assignedTo?: string;
}

export const processSafetyAlertAction = async (
  data: SafetyAlertActionInput,
): Promise<SafetyAlertDTO> => {
  objectIdField(data.alertId, 'alert ID');
  const action = enumField(data.action, 'safety alert action', [
    'assign',
    'resolve',
    'escalate',
  ] as const);
  if (action !== 'assign' && data.assignedTo !== undefined)
    throw new RequestContractError(400, 'Unsupported assignment field');
  const actor = await principalWriteActor(data.actorId, data.branchId);
  const alert = await SafetyAlert.findById(data.alertId)
    .where('branchId')
    .equals(data.branchId);
  if (!alert) throw new RequestContractError(404, 'Safety alert not found');
  if (
    ![SAFETY_ALERT_STATUSES.OPEN, SAFETY_ALERT_STATUSES.IN_PROGRESS].includes(
      alert.status as 'open' | 'in_progress',
    )
  ) {
    throw new RequestContractError(
      409,
      'Safety alert action is not allowed in its current state',
    );
  }
  const update: {
    assignedTo?: Types.ObjectId;
    status: string;
    resolvedAt?: Date;
    severity?: string;
  } = {
    status:
      action === 'resolve'
        ? SAFETY_ALERT_STATUSES.RESOLVED
        : SAFETY_ALERT_STATUSES.IN_PROGRESS,
  };
  if (action === 'assign') {
    const assignee = await principalWriteAssignee(
      data.assignedTo,
      data.branchId,
    );
    if (
      String(alert.assignedTo) === assignee._id.toString() &&
      alert.status === SAFETY_ALERT_STATUSES.IN_PROGRESS
    ) {
      throw new RequestContractError(
        409,
        'Safety alert is already assigned to this user',
      );
    }
    update.assignedTo = assignee._id;
  }
  if (action === 'resolve') update.resolvedAt = new Date();
  if (action === 'escalate') {
    if (
      alert.severity === SAFETY_ALERT_SEVERITIES.CRITICAL &&
      alert.status === SAFETY_ALERT_STATUSES.IN_PROGRESS
    ) {
      throw new RequestContractError(409, 'Safety alert is already escalated');
    }
    update.severity = SAFETY_ALERT_SEVERITIES.CRITICAL;
  }
  return withPrincipalWriteAuthority(data, PERMISSIONS.PRINCIPAL_SAFETY_MANAGE, async session => {
    const updated = await SafetyAlert.findOneAndUpdate(
      {
        _id: alert._id,
        branchId: alert.branchId,
        status: alert.status,
        severity: alert.severity,
        assignedTo: alert.assignedTo ?? null,
        updatedAt: alert.updatedAt,
        __v: alert.__v ?? { $exists: false },
      },
      {
        $set: update,
        $push: {
          history: {
            action,
            performedBy: actor._id,
            ...(update.assignedTo ? { assignedTo: update.assignedTo } : {}),
            createdAt: new Date(),
          },
        },
        $inc: { __v: 1 },
      },
      { returnDocument: 'after', runValidators: true, session },
    );
    if (!updated)
      throw new RequestContractError(
        409,
        'Safety alert changed or was already processed',
      );
    // Prepare the public projection before commit: a failed identity lookup
    // must abort the state/history write rather than fail after it commits.
    // withPrincipalWriteAuthority exposes this result only after commit succeeds.
    return (await serializeSafetyAlerts([updated], true, session))[0];
  }, async session => {
    if (update.assignedTo) await fencePrincipalWriteUser(String(update.assignedTo), data.branchId, PRINCIPAL_WRITE_ASSIGNEE_ROLES, session);
  });
};
