import { createHash, randomBytes } from 'node:crypto';
import { resolveZegoCredentials } from '../../../../zegoConfig';

// Separate from the pure credential signer: never call this inside a retryable
// Mongo transaction. Official KickoutUser, signature version 2.0.
export async function kickZegoUser(
  roomId: string,
  userId: string,
  request: typeof fetch = fetch,
  until = new Date(Date.now() + 600000),
) {
  const creds = resolveZegoCredentials(process.env);
  if (!creds.valid) {
    throw new Error('Provider control unavailable');
  }
  const appId = creds.appId;
  const secret = (creds as { serverSecret: string }).serverSecret;
  const call = async (parameters: Record<string, string>) => {
    const nonce = randomBytes(8).toString('hex');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHash('md5')
      .update(String(appId) + nonce + secret + timestamp)
      .digest('hex');
    const url = new URL('https://rtc-api.zego.im/');
    url.search = new URLSearchParams({
      AppId: String(appId),
      SignatureNonce: nonce,
      Timestamp: timestamp,
      Signature: signature,
      SignatureVersion: '2.0',
      RoomId: roomId,
      ...parameters,
    }).toString();
    try {
      const response = await request(url, {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      const body = (await response.json()) as { Code?: number };
      if (!response.ok || body.Code !== 0) throw new Error('provider');
    } catch {
      throw new Error('Provider removal could not be confirmed');
    }
  };
  // A kick alone does not invalidate an already-issued Token04. Ban login for
  // the remaining credential lifetime, then independently attempt the kick.
  if (until.getTime() <= Date.now())
    throw new Error('Provider removal could not be confirmed');
  let failed = false;
  try {
    await call({
      Action: 'SetForbidUserRule',
      RuleType: '4',
      UserId: userId,
      'DisabledPrivilege[]': '1',
      EffectiveTime: String(
        Math.min(
          86400,
          Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)),
        ),
      ),
    });
  } catch {
    failed = true;
  }
  // A slow response must not start a fresh kick after this job's credential
  // generation expired and a later authorized connection can reclaim the lease.
  if (until.getTime() <= Date.now())
    throw new Error('Provider removal could not be confirmed');
  try {
    await call({
      Action: 'KickoutUser',
      'UserId[]': userId,
      CustomReason: 'School classroom access closed',
    });
  } catch {
    failed = true;
  }
  if (failed) throw new Error('Provider removal could not be confirmed');
}
