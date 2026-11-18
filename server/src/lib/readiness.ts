import mongoose from 'mongoose';

export async function databaseReady() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 }, { timeoutMS: 2000 });
    return !!hello.setName && hello.isWritablePrimary === true;
  } catch {
    return false;
  }
}
