import mongoose from 'mongoose';
import Branch from '../../src/staff/src/models/branch';
import { createLiveLessonService } from '../../src/staff/src/services/live-lesson.service';
import type { RtcProvider } from '../../src/staff/src/services/rtc/rtc-provider';
import type { JwtPayload } from '../../src/staff/src/services/jwt.service';

// Independent process connected only to the parent's owned ephemeral database.
async function main() {
  const [uri, clock] = process.argv.slice(2);
  if (!uri?.startsWith('mongodb://127.0.0.1:'))
    throw new Error('Owned test database required');
  Date.now = () => Number(clock);
  await mongoose.connect(uri, { autoIndex: false });
  const original = Branch.collection.updateOne;
  Branch.collection.updateOne = function (
    this: typeof Branch.collection,
    ...args: Parameters<typeof original>
  ) {
    process.send?.({ type: 'fence' });
    return original.apply(this, args);
  } as typeof original;
  const provider: RtcProvider = {
    publicConfig: () => ({ provider: 'fake', appId: 123 }),
    name: 'fake',
    roomId: id => 'room_' + id,
    issueCredential(input) {
      process.send?.({ type: 'signer' });
      return {
        provider: 'fake',
        appId: 123,
        roomId: input.roomId,
        userId: 'opaque',
        token: 'synthetic',
        role: input.role,
        expiresAt: input.expiresAt.toISOString(),
      };
    },
  };
  const service = createLiveLessonService(
    () => provider,
    async () => {
      process.send?.({ type: 'kick' });
    },
  );
  process.on(
    'message',
    async (message: {
      action:
        | 'start'
        | 'join'
        | 'admission'
        | 'moderate'
        | 'enforce'
        | 'shutdown';
      identity: JwtPayload;
      token: string;
      id: string;
      date: string;
      connectionId?: string;
      participantId?: string;
      operation?: string;
    }) => {
      if (message.action === 'shutdown') {
        await mongoose.disconnect();
        process.disconnect();
        return;
      }
      try {
        if (message.action === 'enforce') {
          await service.enforceRemoval(message.id);
          process.send?.({ type: 'result', ok: true });
          return;
        }
        const result =
          message.action === 'start'
            ? await service.start(
                message.identity,
                message.token,
                message.id,
                message.date,
                message.connectionId,
              )
            : message.action === 'admission'
            ? await service.requestAdmission(
                message.identity,
                message.token,
                message.id,
                message.connectionId,
              )
            : message.action === 'moderate'
            ? await service.moderate(
                message.identity,
                message.token,
                message.id,
                message.participantId,
                message.operation,
              )
            : await service.join(
                message.identity,
                message.token,
                message.id,
                message.connectionId,
              );
        process.send?.({
          type: 'result',
          ok: true,
          id: 'session' in result ? result.session.id : result.participant.id,
        });
      } catch {
        process.send?.({ type: 'result', ok: false });
      }
    },
  );
  process.send?.({ type: 'ready' });
}
main().catch(() => {
  process.send?.({ type: 'failure' });
  process.exitCode = 1;
});
