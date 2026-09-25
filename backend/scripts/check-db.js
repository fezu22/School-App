import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
try {
  if (!process.env.MONGODB_URI) throw new Error('Missing database configuration');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, autoIndex: false, autoCreate: false });
  await mongoose.connection.db.command({ ping: 1 });
  console.log('MongoDB connection: OK');
  console.log('Selected database:', mongoose.connection.name);
  const databases = await mongoose.connection.db.admin().listDatabases({ nameOnly: true, authorizedDatabases: true });
  console.log('Accessible databases:', databases.databases.map(db => db.name).join(', '));
} catch (error) {
  console.error('MongoDB check failed:', error.name, 'code:', error.code ?? 'unavailable');
  console.error('Check credentials, Atlas network access, and network connectivity.');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
