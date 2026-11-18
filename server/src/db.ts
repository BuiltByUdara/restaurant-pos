import mongoose from 'mongoose';
import { databaseReady } from './lib/readiness.js';
export async function connectDatabase(uri: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  if (!(await databaseReady())) {
    await mongoose.disconnect();
    throw new Error('MongoDB must be a writable replica set. See docs/phase-8.md.');
  }
}
