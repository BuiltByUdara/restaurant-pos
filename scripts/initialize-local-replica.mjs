import mongoose from 'mongoose';
try {
  await mongoose.connect('mongodb://127.0.0.1:27017/admin?directConnection=true', {
    serverSelectionTimeoutMS: 20000,
  });
  const admin = mongoose.connection.db.admin();
  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    if (status.set !== 'rs0') throw new Error('Unexpected replica set; refusing to change it.');
  } catch (error) {
    if (error.code !== 94) throw error;
    await admin.command({
      replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] },
    });
  }
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const hello = await admin.command({ hello: 1 });
    if (hello.setName === 'rs0' && hello.isWritablePrimary) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Replica set did not become primary within 30 seconds.');
  console.log(
    'rs0 is writable. Existing database files were preserved. Retry saving your category.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
