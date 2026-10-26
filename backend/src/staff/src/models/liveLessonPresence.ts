import { Schema, model } from 'mongoose';

// Operational classroom presence, never school Attendance. One logical row per
// actor/lesson; bounded history records transitions rather than SDK heartbeats.
const schema = new Schema(
  {
    liveLessonSessionId: {
      type: Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    branchId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    actorId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    role: { type: String, enum: ['host', 'participant'], required: true },
    admission: {
      type: String,
      enum: ['waiting', 'admitted', 'rejected', 'removed', 'left'],
      required: true,
    },
    connectionState: {
      type: String,
      enum: ['disconnected', 'connected', 'reconnecting'],
      default: 'disconnected',
      required: true,
    },
    connectionId: String,
    loginHash: String,
    leaseUntil: Date,
    credentialUntil: Date,
    providerUserId: String,
    requestedAt: Date,
    admittedAt: Date,
    firstJoinedAt: Date,
    lastSeenAt: Date,
    leftAt: Date,
    handRaised: { type: Boolean, default: false },
    reconnectCount: { type: Number, default: 0 },
    revision: { type: Number, default: 1 },
    actionAfter: Date,
    issuanceAfter: Date,
    issuanceCount: { type: Number, default: 0 },
    enforcement: {
      type: String,
      enum: ['none', 'pending', 'confirmed', 'failed', 'expired'],
      default: 'none',
    },
    enforcementAfter: Date,
    enforcementAttempts: { type: Number, default: 0 },
    checkedAt: Date,
    history: [
      { _id: false, event: String, at: Date, by: Schema.Types.ObjectId },
    ],
  },
  { timestamps: true },
);
schema.index(
  { liveLessonSessionId: 1, actorId: 1 },
  { unique: true, name: 'unique_classroom_actor' },
);
schema.index({ liveLessonSessionId: 1, admission: 1 });
schema.index({ enforcement: 1, enforcementAfter: 1 });
// explain() showed a collection scan + blocking sort for every maintenance
// cycle. Equality on admission then oldest checkedAt supports its bounded scan.
schema.index(
  { admission: 1, checkedAt: 1 },
  { name: 'active_classroom_maintenance' },
);
export const LiveLessonPresence = model('LiveLessonPresence', schema);
export const ensureLivePresenceIndexes = () =>
  LiveLessonPresence.createIndexes();
