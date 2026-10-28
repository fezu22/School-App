import {authenticatedTransaction} from './authenticated-session.service';
import mongoose, {type ClientSession} from 'mongoose';
import Branch from '../models/branch';
import {RequestContractError} from '../utils/request-validation';

// Every participating writer changes the same persisted Branch document before
// reading dependencies. Across processes, MongoDB aborts a competing snapshot
// with a write conflict; withTransaction retries it against the winning commit.
// Never replace this increment with a no-op or an in-process mutex.
export async function withAcademicCatalogLock<T>(branchId: string, write: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    return await authenticatedTransaction(session, async () => {
      const lock = await Branch.collection.updateOne({_id: new mongoose.Types.ObjectId(branchId), isActive: true}, {$inc: {__v: 1}}, {session});
      if (!lock.matchedCount) throw new RequestContractError(404, 'Academic branch is unavailable');
      return write(session);
    }, {readPreference: 'primary', readConcern: {level: 'snapshot'}, writeConcern: {w: 'majority'}});
  } catch (error) {
    const failure = error as {code?: number; message?: string};
    if (failure.code === 20 || failure.message?.includes('This MongoDB deployment does not support retryable writes')) {
      throw new RequestContractError(503, 'Academic catalog writes require a MongoDB replica set or sharded cluster');
    }
    throw error;
  } finally {await session.endSession();}
}
