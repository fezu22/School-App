function resolveAliasedValue(env, primaryKey, aliasKey, label) {
  const rawPrimary = env?.[primaryKey];
  const rawAlias = aliasKey ? env?.[aliasKey] : undefined;
  const hasPrimary = rawPrimary !== undefined && rawPrimary !== null && String(rawPrimary).trim() !== '';
  const hasAlias = rawAlias !== undefined && rawAlias !== null && String(rawAlias).trim() !== '';

  if (hasPrimary && hasAlias && String(rawPrimary).trim() !== String(rawAlias).trim()) {
    return {
      value: '',
      conflict: true,
      reason: `Conflicting ${label} values between ${primaryKey} and ${aliasKey}.`,
    };
  }

  return {
    value: hasPrimary ? String(rawPrimary).trim() : hasAlias ? String(rawAlias).trim() : '',
    conflict: false,
    reason: null,
  };
}

function resolveZegoCredentials(env = process.env) {
  const appIdAttr = resolveAliasedValue(env, 'ZEGOCLOUD_APP_ID', 'ZEGO_APP_ID', 'ZEGO App ID');
  const secretAttr = resolveAliasedValue(
    env,
    'ZEGOCLOUD_SERVER_SECRET',
    'ZEGO_SERVER_SECRET',
    'ZEGO Server Secret',
  );

  if (appIdAttr.conflict || secretAttr.conflict) {
    return {
      valid: false,
      conflict: true,
      reason: appIdAttr.reason || secretAttr.reason,
      appId: NaN,
      serverSecret: '',
    };
  }

  const appId = Number(appIdAttr.value);
  const serverSecret = secretAttr.value;
  const validAppId =
     appIdAttr.value !== '' &&
    Number.isInteger(appId) &&
    appId > 0 &&
    appId <= 0xffffffff;
  const validSecret = /^[\x21-\x7e]{32}$/.test(serverSecret);

  const result = {
    valid: validAppId && validSecret,
    conflict: false,
    reason: !validAppId
      ? 'Invalid or missing ZEGOCLOUD_APP_ID / ZEGO_APP_ID.'
      : !validSecret
        ? 'Invalid or missing 32-byte ASCII ZEGOCLOUD_SERVER_SECRET / ZEGO_SERVER_SECRET.'
        : null,
    appId: validAppId ? appId : NaN,
  };

  Object.defineProperty(result, 'serverSecret', {
    value: validSecret ? serverSecret : '',
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return result;
}

function resolveZegoConfiguration(env = process.env) {
  const enabledAttr = resolveAliasedValue(
    env,
    'LIVE_LESSON_ENABLED',
    'LIVE_LESSONS_VERIFIED',
    'live lesson enable flag',
  );
  const privilegesAttr = resolveAliasedValue(
    env,
    'ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED',
    'ZEGO_ROOM_PRIVILEGES_ENABLED',
    'ZEGO room privileges flag',
  );
  const ttlAttr = resolveAliasedValue(
    env,
    'LIVE_LESSON_TOKEN_TTL_SECONDS',
    'ZEGO_TOKEN_TTL_SECONDS',
    'ZEGO token TTL',
  );
  const creds = resolveZegoCredentials(env);

  if (enabledAttr.conflict || privilegesAttr.conflict || ttlAttr.conflict || creds.conflict) {
    const conflictReason =
      enabledAttr.reason || privilegesAttr.reason || ttlAttr.reason || creds.reason;
    const conflictResult = {
      enabled: false,
      conflict: true,
      reason: conflictReason,
      appId: NaN,
      ttlSeconds: NaN,
      roomPrivilegesEnabled: false,
    };
    Object.defineProperty(conflictResult, 'serverSecret', {
      value: '',
      enumerable: false,
    });
    return conflictResult;
  }

  const liveEnabled = enabledAttr.value === 'true';
  const roomPrivilegesEnabled = privilegesAttr.value === 'true';
  const ttlSeconds = ttlAttr.value === '' ? 300 : Number(ttlAttr.value);
  const validTtl = Number.isInteger(ttlSeconds) && ttlSeconds >= 30 && ttlSeconds <= 600;

  const enabled = liveEnabled && roomPrivilegesEnabled && creds.valid && validTtl;

  let reason = null;
  if (!liveEnabled) {
    reason = 'Live lessons are not enabled (LIVE_LESSON_ENABLED / LIVE_LESSONS_VERIFIED must be "true").';
  } else if (!roomPrivilegesEnabled) {
    reason = 'ZEGO room privileges enforcement is not enabled (ZEGOCLOUD_ROOM_PRIVILEGES_ENABLED must be "true").';
  } else if (!creds.valid) {
    reason = creds.reason;
  } else if (!validTtl) {
    reason = 'LIVE_LESSON_TOKEN_TTL_SECONDS must be an integer between 30 and 600.';
  }

  const config = {
    enabled,
    conflict: false,
    reason,
    appId: enabled ? creds.appId : NaN,
    ttlSeconds: validTtl ? ttlSeconds : NaN,
    roomPrivilegesEnabled,
  };

  Object.defineProperty(config, 'serverSecret', {
    value: enabled ? creds.serverSecret : '',
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return config;
}

function isZegoLiveLessonEnabled(env = process.env) {
  return resolveZegoConfiguration(env).enabled;
}

module.exports = {
  resolveAliasedValue,
  resolveZegoCredentials,
  resolveZegoConfiguration,
  isZegoLiveLessonEnabled,
};
