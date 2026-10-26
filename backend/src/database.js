const { MongoClient } = require('mongodb');

let client;
let database;

function getMongoConfig(env = process.env) {
  const uri = String(env.MONGODB_URI || '').trim();
  const databaseName = String(env.MONGODB_DB || '').trim();
  const missing = [];
  if (!uri) missing.push('MONGODB_URI');
  if (!databaseName) missing.push('MONGODB_DB');
  if (missing.length) {
    throw new Error(
      `Missing required MongoDB environment variable(s): ${missing.join(
        ', ',
      )}. Copy backend/.env.example to backend/.env and set these values.`,
    );
  }
  return { uri, databaseName };
}

async function connectDatabase(env = process.env) {
  const { uri, databaseName } = getMongoConfig(env);
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    database = client.db(databaseName);
    await database.command({ ping: 1 });
    return database;
  } catch (error) {
    await client.close().catch(() => {});
    client = undefined;
    database = undefined;
    throw new Error(
      `Could not connect to MongoDB database "${databaseName}". Check MONGODB_URI and confirm the server is reachable. ${error.message}`,
      { cause: error },
    );
  }
}

function getDatabase() {
  if (!database)
    throw new Error(
      'MongoDB is not connected. Start the API through src/server.js and wait for database initialization.',
    );
  return database;
}

function getClient() {
  if (!client) {
    throw new Error(
      'MongoDB is not connected. Start the API through src/server.js and wait for database initialization.',
    );
  }
  return client;
}

async function closeDatabase() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}

module.exports = {
  connectDatabase,
  getDatabase,
  getClient,
  closeDatabase,
  getMongoConfig,
};
