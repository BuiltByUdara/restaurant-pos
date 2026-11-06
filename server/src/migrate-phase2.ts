import mongoose from 'mongoose';
import { roleNames, rolePermissions } from '@restaurant/shared';
import { readConfig } from './config.js';
import { connectDatabase } from './db.js';
import { Role } from './modules/auth/models.js';
import { initializeConfiguration } from './modules/configuration/models.js';
try {
  await connectDatabase(readConfig().MONGODB_URI);
  await initializeConfiguration();
  for (const name of roleNames) {
    const additions = rolePermissions[name].filter(
      (p) => p.startsWith('menu:') || p.startsWith('tables:'),
    );
    await Role.updateOne(
      { name },
      { $addToSet: { permissions: { $each: additions } } },
      { runValidators: true },
    );
  }
  console.log(
    'Phase 2 indexes and built-in role permissions are ready. Existing records and passwords were preserved. Sign out and back in to refresh navigation.',
  );
} finally {
  await mongoose.disconnect();
}
