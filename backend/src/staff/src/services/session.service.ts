import {Types} from 'mongoose';
import Session, {ISession} from '../models/session';

export const registerSession = async (
  userId: string,
  token: string,
  role: string,
): Promise<ISession> => {
  const session = new Session({
    userId: new Types.ObjectId(userId),
    token,
    role,
    isRevoked: false,
  });

  await session.save();

  return session;
};

export const isTokenRevoked = async (token: string): Promise<boolean> => {
  const session = await Session.findOne({token});

  // Every access token issued by the login flow is registered as a session.
  // Treat a missing record as invalid so a missing session cannot turn an
  // otherwise valid JWT into an unrevocable session.
  return !session || session.isRevoked;
};

export const getSessions = async (): Promise<ISession[]> => {
  return Session.find()
    .select('-token')
    .populate('userId', 'fullName email role')
    .sort({createdAt: -1});
};

export const revokeSession = async (
  sessionId: string,
  revokedBy: string,
): Promise<ISession> => {
  if (!Types.ObjectId.isValid(sessionId)) {
    throw new Error('Invalid session ID');
  }

  if (!Types.ObjectId.isValid(revokedBy)) {
    throw new Error('Invalid reviewer ID');
  }

  const session = await Session.findOneAndUpdate(
    { _id: sessionId, isRevoked: false },
    {
      $set: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedBy: new Types.ObjectId(revokedBy),
      },
    },
    { new: true, runValidators: true },
  ).select('-token');

  if (session) return session;

  const exists = await Session.exists({ _id: sessionId });
  if (!exists) throw new Error('Session not found');
  throw new Error('Session is already revoked');
};
