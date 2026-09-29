import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const envPath = fileURLToPath(new URL('../../.env', import.meta.url));

if (!existsSync(envPath)) {
  throw new Error(`Backend environment file not found: ${envPath}`);
}

dotenv.config({ path: envPath });

if (!process.env.MONGODB_URI?.trim()) {
  throw new Error(`MONGODB_URI is required in ${envPath}`);
}

if (!process.env.JWT_SECRET?.trim()) {
  throw new Error(`JWT_SECRET is required in ${envPath}`);
}

if (
  process.env.JWT_SECRET.length < 32 ||
  process.env.JWT_SECRET.includes('replace')
) {
  throw new Error('Set a random JWT_SECRET of at least 32 characters');
}

let mongoUsername = 'unavailable';
let databaseName = 'unavailable';
let clusterHost = 'unavailable';

try {
  const mongoUrl = new URL(process.env.MONGODB_URI);
  mongoUsername = decodeURIComponent(mongoUrl.username) || 'not specified';
  databaseName = decodeURIComponent(mongoUrl.pathname.slice(1)) || 'not specified';
  clusterHost = mongoUrl.hostname || 'not specified';
} catch {
  // Keep startup diagnostics free of the URI when it is malformed.
}

console.info(`Backend environment file: ${envPath}`);
console.info(`MongoDB username: ${mongoUsername}`);
console.info(`MongoDB database: ${databaseName}`);
console.info(`MongoDB cluster host: ${clusterHost}`);
