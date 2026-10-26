import { createHash } from 'node:crypto';
import { Types, type ClientSession } from 'mongoose';
import { LiveLessonPresence } from '../models/liveLessonPresence';
import { RequestContractError } from '../utils/request-validation';

export type Presence = InstanceType<typeof LiveLessonPresence>;
export function connectionKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(value))
    throw new RequestContractError(400, 'Invalid classroom connection ID');
  return value;
}
export function event(row: Presence, name: string, by: string) {
  row.history.push({
    event: name,
    at: new Date(Date.now()),
    by: new Types.ObjectId(by),
  });
  if (row.history.length > 100) row.history.splice(0, row.history.length - 100);
  row.revision++;
}
export function claim(row: Presence, token: string, key: string) {
  const hash = createHash('sha256').update(token).digest('hex');
  if (
    row.leaseUntil &&
    row.leaseUntil.getTime() > Date.now() &&
    (row.connectionId !== key || row.loginHash !== hash)
  )
    throw new RequestContractError(
      409,
      'This lesson is open on another connection. Leave it and wait for its access lease to expire.',
    );
  // A stale maintenance decision must not revoke a newer login/lease owner.
  if (row.connectionId !== key || row.loginHash !== hash) row.revision++;
  row.connectionId = key;
  row.loginHash = hash;
  // Waiting requests also own a short lease, renewed by status heartbeats.
  row.leaseUntil = new Date(
    Math.max(Date.now() + 30000, (row.credentialUntil?.getTime() ?? 0) + 5000),
  );
}
export function rate(row: Presence, issuance = false) {
  if (issuance) {
    if (!row.issuanceAfter || row.issuanceAfter.getTime() <= Date.now()) {
      row.issuanceAfter = new Date(Date.now() + 60000);
      row.issuanceCount = 0;
    }
    if (row.issuanceCount >= 10)
      throw new RequestContractError(
        429,
        'Please wait before requesting more live access',
      );
    row.issuanceCount++;
    return;
  }
  const field = issuance ? 'issuanceAfter' : 'actionAfter';
  if (row[field] && row[field]!.getTime() > Date.now())
    throw new RequestContractError(
      429,
      'Please wait before repeating this classroom action',
    );
  row[field] = new Date(Date.now() + 500);
}
export function closePresence(row: Presence, by: string, removed = false) {
  if (row.admission === 'removed' || row.admission === 'rejected') return;
  if (row.admission === 'left' && !removed) return;
  row.admission = removed ? 'removed' : 'left';
  row.handRaised = false;
  row.connectionState = 'disconnected';
  row.leftAt = new Date(Date.now());
  if (
    row.providerUserId &&
    row.credentialUntil &&
    row.credentialUntil.getTime() > Date.now()
  ) {
    row.enforcement = 'pending';
    row.enforcementAfter = new Date(Date.now());
  }
  event(row, removed ? 'removed' : 'left', by);
}
export async function presenceFor(
  lesson: { _id: unknown; branchId: unknown },
  actorId: string,
  session: ClientSession,
) {
  return LiveLessonPresence.findOne({
    liveLessonSessionId: String(lesson._id),
    actorId,
  }).session(session);
}
export function presenceDTO(row: Presence, displayName: string) {
  return {
    id: String(row._id),
    displayName,
    role: row.role,
    admission: row.admission,
    handRaised: row.handRaised,
    connectionState:
      row.lastSeenAt && Date.now() - row.lastSeenAt.getTime() < 30000
        ? row.connectionState
        : 'disconnected',
    reconnectCount: row.reconnectCount,
    enforcement: row.enforcement,
    requestedAt: row.requestedAt?.toISOString() ?? null,
    admittedAt: row.admittedAt?.toISOString() ?? null,
    firstJoinedAt: row.firstJoinedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}
