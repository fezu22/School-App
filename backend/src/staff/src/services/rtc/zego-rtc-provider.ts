import {
  createCipheriv,
  createHmac,
  randomBytes,
  randomInt,
} from 'node:crypto';
import { RequestContractError } from '../../utils/request-validation';
import type {
  RtcProvider,
  RtcCredentialRequest,
  RtcCredential,
} from './rtc-provider';
const unavailable = () =>
  new RequestContractError(
    503,
    'Live lesson provider configuration is unavailable',
  );
export class ZegoRtcProvider implements RtcProvider {
  readonly name = 'zegocloud';
  private readonly appId: number;
  private readonly secret: string;
  private readonly ttl: number;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.appId = Number(env.ZEGOCLOUD_APP_ID);
    this.secret = env.ZEGOCLOUD_SERVER_SECRET ?? '';
    this.ttl = Number(env.LIVE_LESSON_TOKEN_TTL_SECONDS ?? 300);
    if (
      env.LIVE_LESSON_ENABLED !== 'true' ||
      env.ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED !== 'true' ||
      !Number.isInteger(this.appId) ||
      this.appId <= 0 ||
      this.appId > 0xffffffff ||
      !/^[\x21-\x7e]{32}$/.test(this.secret) ||
      !Number.isInteger(this.ttl) ||
      this.ttl < 30 ||
      this.ttl > 600
    )
      throw unavailable();
  }
  publicConfig() {
    return { provider: this.name, appId: this.appId };
  }
  roomId(sessionId: string) {
    return (
      'll_' +
      createHmac('sha256', this.secret)
        .update('room/' + sessionId)
        .digest('hex')
        .slice(0, 40)
    );
  }
  issueCredential(input: RtcCredentialRequest): RtcCredential {
    const now = Math.floor(Date.now() / 1000);
    const expiry = Math.min(
      now + this.ttl,
      Math.floor(input.expiresAt.getTime() / 1000),
    );
    if (expiry <= now)
      throw new RequestContractError(
        409,
        'Live lesson credential window has closed',
      );
    const userId =
      'u_' +
      createHmac('sha256', this.secret)
        .update(input.sessionId + '/' + input.actorId)
        .digest('hex')
        .slice(0, 40);
    // Token04 wire format from ZEGOCLOUD's server assistant: AES-256-CBC,
    // expiry int64 BE, length-prefixed IV and ciphertext, version 04 + base64.
    // https://github.com/ZEGOCLOUD/zego_server_assistant
    const payload = JSON.stringify({
      room_id: input.roomId,
      privilege: { 1: 1, 2: input.role === 'host' ? 1 : 0 },
      stream_id_list: [],
    });
    const claims = JSON.stringify({
      app_id: this.appId,
      user_id: userId,
      ctime: now,
      expire: expiry,
      nonce: randomInt(-2147483648, 2147483647),
      payload,
    });
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', Buffer.from(this.secret), iv);
    const encrypted = Buffer.concat([
      cipher.update(claims, 'utf8'),
      cipher.final(),
    ]);
    const header = Buffer.alloc(10),
      length = Buffer.alloc(2);
    header.writeBigInt64BE(BigInt(expiry));
    header.writeUInt16BE(iv.length, 8);
    length.writeUInt16BE(encrypted.length);
    return {
      provider: this.name,
      appId: this.appId,
      roomId: input.roomId,
      userId,
      token:
        '04' +
        Buffer.concat([header, iv, length, encrypted]).toString('base64'),
      expiresAt: new Date(expiry * 1000).toISOString(),
      role: input.role,
    };
  }
}
