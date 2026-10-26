import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createHash } from 'node:crypto';
import { kickZegoUser } from '../src/staff/src/services/rtc/zego-room-control';

test('official server kick uses scoped identity, v2 signature, bounded transport and no raw error leakage', async () => {
  const previousId = process.env.ZEGOCLOUD_APP_ID,
    previousSecret = process.env.ZEGOCLOUD_SERVER_SECRET;
  process.env.ZEGOCLOUD_APP_ID = '123';
  process.env.ZEGOCLOUD_SERVER_SECRET = '0123456789abcdef0123456789abcdef';
  try {
    let count = 0;
    const request = (async (input: URL | RequestInfo, init?: RequestInit) => {
      count++;
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://rtc-api.zego.im');
      assert.equal(
        url.searchParams.get('Action'),
        count === 1 ? 'SetForbidUserRule' : 'KickoutUser',
      );
      assert.equal(url.searchParams.get('RoomId'), 'opaque-room');
      assert.equal(
        url.searchParams.get(count === 1 ? 'UserId' : 'UserId[]'),
        'opaque-user',
      );
      if (count === 1) {
        assert.equal(url.searchParams.get('RuleType'), '4');
        assert.equal(url.searchParams.get('DisabledPrivilege[]'), '1');
        assert.ok(Number(url.searchParams.get('EffectiveTime')) <= 600);
      }
      assert.equal(
        url.searchParams.get('Signature'),
        createHash('md5')
          .update(
            '123' +
              url.searchParams.get('SignatureNonce') +
              process.env.ZEGOCLOUD_SERVER_SECRET +
              url.searchParams.get('Timestamp'),
          )
          .digest('hex'),
      );
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      return new Response(JSON.stringify({ Code: 0 }));
    }) as typeof fetch;
    await kickZegoUser('opaque-room', 'opaque-user', request);
    assert.equal(count, 2);
    for (const failure of [
      async () => new Response(JSON.stringify({ Code: 9 })),
      async () => {
        throw new Error('private signature bearer token');
      },
    ]) {
      await assert.rejects(
        kickZegoUser('room', 'user', failure as typeof fetch),
        error =>
          error instanceof Error &&
          error.message === 'Provider removal could not be confirmed',
      );
    }
  } finally {
    if (previousId === undefined) delete process.env.ZEGOCLOUD_APP_ID;
    else process.env.ZEGOCLOUD_APP_ID = previousId;
    if (previousSecret === undefined)
      delete process.env.ZEGOCLOUD_SERVER_SECRET;
    else process.env.ZEGOCLOUD_SERVER_SECRET = previousSecret;
  }
});

test('closure: a slow ban response cannot kick a later connection after the old credential expires', async () => {
  const previousId = process.env.ZEGOCLOUD_APP_ID,
    previousSecret = process.env.ZEGOCLOUD_SERVER_SECRET;
  process.env.ZEGOCLOUD_APP_ID = '123';
  process.env.ZEGOCLOUD_SERVER_SECRET = '0123456789abcdef0123456789abcdef';
  const started = Date.now();
  let now = started,
    requests = 0;
  mock.method(Date, 'now', () => now);
  try {
    const request = (async () => {
      requests++;
      now = started + 2000;
      return new Response(JSON.stringify({ Code: 0 }));
    }) as typeof fetch;
    await assert.rejects(
      kickZegoUser('room', 'user', request, new Date(started + 1000)),
      /Provider removal could not be confirmed/,
    );
    assert.equal(requests, 1);
  } finally {
    mock.restoreAll();
    if (previousId === undefined) delete process.env.ZEGOCLOUD_APP_ID;
    else process.env.ZEGOCLOUD_APP_ID = previousId;
    if (previousSecret === undefined)
      delete process.env.ZEGOCLOUD_SERVER_SECRET;
    else process.env.ZEGOCLOUD_SERVER_SECRET = previousSecret;
  }
});
