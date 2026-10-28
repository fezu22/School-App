import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createHash } from 'node:crypto';
import { kickZegoUser } from '../src/staff/src/services/rtc/zego-room-control';

test('official server kick uses scoped identity, v2 signature, bounded transport and no raw error leakage', { concurrency: false }, async () => {
  const previousId = process.env.ZEGOCLOUD_APP_ID,
    previousSecret = process.env.ZEGOCLOUD_SERVER_SECRET,
    previousAliasId = process.env.ZEGO_APP_ID,
    previousAliasSecret = process.env.ZEGO_SERVER_SECRET;
  delete process.env.ZEGO_APP_ID;
  delete process.env.ZEGO_SERVER_SECRET;
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
    if (previousAliasId === undefined) delete process.env.ZEGO_APP_ID;
    else process.env.ZEGO_APP_ID = previousAliasId;
    if (previousAliasSecret === undefined) delete process.env.ZEGO_SERVER_SECRET;
    else process.env.ZEGO_SERVER_SECRET = previousAliasSecret;
  }
});

test('closure: a slow ban response cannot kick a later connection after the old credential expires', { concurrency: false }, async () => {
  const previousId = process.env.ZEGOCLOUD_APP_ID,
    previousSecret = process.env.ZEGOCLOUD_SERVER_SECRET,
    previousAliasId = process.env.ZEGO_APP_ID,
    previousAliasSecret = process.env.ZEGO_SERVER_SECRET;
  delete process.env.ZEGO_APP_ID;
  delete process.env.ZEGO_SERVER_SECRET;
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
    if (previousAliasId === undefined) delete process.env.ZEGO_APP_ID;
    else process.env.ZEGO_APP_ID = previousAliasId;
    if (previousAliasSecret === undefined) delete process.env.ZEGO_SERVER_SECRET;
    else process.env.ZEGO_SERVER_SECRET = previousAliasSecret;
  }
});

test('kickZegoUser supports ZEGO_* aliases and rejects conflicting ZEGOCLOUD_* / ZEGO_* values', { concurrency: false }, async () => {
  const prevZegoCloudId = process.env.ZEGOCLOUD_APP_ID;
  const prevZegoId = process.env.ZEGO_APP_ID;
  const prevZegoCloudSecret = process.env.ZEGOCLOUD_SERVER_SECRET;
  const prevZegoSecret = process.env.ZEGO_SERVER_SECRET;
  try {
    delete process.env.ZEGOCLOUD_APP_ID;
    delete process.env.ZEGOCLOUD_SERVER_SECRET;
    process.env.ZEGO_APP_ID = '456';
    process.env.ZEGO_SERVER_SECRET = '0123456789abcdef0123456789abcdef';

    let called = 0;
    const okFetch = (async () => {
      called++;
      return new Response(JSON.stringify({ Code: 0 }));
    }) as typeof fetch;
    await kickZegoUser('room-1', 'user-1', okFetch);
    assert.equal(called, 2);

    // Conflicting ZEGO_APP_ID vs ZEGOCLOUD_APP_ID fails closed before network call
    process.env.ZEGOCLOUD_APP_ID = '789';
    let conflictCalls = 0;
    const neverFetch = (async () => {
      conflictCalls++;
      return new Response(JSON.stringify({ Code: 0 }));
    }) as typeof fetch;
    await assert.rejects(
      kickZegoUser('room-1', 'user-1', neverFetch),
      /Provider control unavailable/,
    );
    assert.equal(conflictCalls, 0);
  } finally {
    if (prevZegoCloudId === undefined) delete process.env.ZEGOCLOUD_APP_ID;
    else process.env.ZEGOCLOUD_APP_ID = prevZegoCloudId;
    if (prevZegoId === undefined) delete process.env.ZEGO_APP_ID;
    else process.env.ZEGO_APP_ID = prevZegoId;
    if (prevZegoCloudSecret === undefined) delete process.env.ZEGOCLOUD_SERVER_SECRET;
    else process.env.ZEGOCLOUD_SERVER_SECRET = prevZegoCloudSecret;
    if (prevZegoSecret === undefined) delete process.env.ZEGO_SERVER_SECRET;
    else process.env.ZEGO_SERVER_SECRET = prevZegoSecret;
  }
});

