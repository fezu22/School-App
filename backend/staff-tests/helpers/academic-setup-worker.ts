import mongoose from 'mongoose';
import app from '../../src/staff/src/app';
import Branch from '../../src/staff/src/models/branch';

// Second real Node/API instance against the parent's owned ephemeral replica
// set. IPC reports arrival at the DB fence; it does not arbitrate any writes.
async function start() {
  const uri = process.argv[2];
  if (!uri || !uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Owned local test database required');
  await mongoose.connect(uri, {autoIndex: false});
  const update = Branch.collection.updateOne;
  Branch.collection.updateOne = function (this: typeof Branch.collection, ...args: Parameters<typeof update>) {
    process.send?.({type: 'fence'});
    return update.apply(this, args);
  } as typeof update;
  const server = app.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') process.send?.({type: 'ready', base: `http://127.0.0.1:${address.port}/api`});
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => {mongoose.disconnect().then(() => {if (process.connected) process.disconnect?.();});});
  };
  process.on('message', message => {if (message === 'shutdown') close();});
  process.on('disconnect', close);
}
start().catch(error => {process.send?.({type: 'failure', message: error.message}); process.exitCode = 1;});
