import { z } from 'zod';
import mongoose from 'mongoose';
import { roleNames, rolePermissions } from '@restaurant/shared';
import { readConfig } from './config.js';
import { connectDatabase } from './db.js';
import { Role, User } from './modules/auth/models.js';
import { passwordHash } from './modules/auth/service.js';
const config = readConfig();
const seed = z
  .object({
    SEED_OWNER_NAME: z.string().min(1).max(100),
    SEED_OWNER_EMAIL: z
      .string()
      .email()
      .transform((s) => s.toLowerCase()),
    SEED_OWNER_PASSWORD: z.string().min(14).max(128),
  })
  .parse(process.env);
try {
  await connectDatabase(config.MONGODB_URI);
  for (const name of roleNames)
    await Role.updateOne(
      { name },
      { $set: { permissions: rolePermissions[name] } },
      { upsert: true, runValidators: true },
    );
  const role = await Role.findOne({ name: 'Owner' });
  if (!(await User.exists({ email: seed.SEED_OWNER_EMAIL }))) {
    await User.create({
      name: seed.SEED_OWNER_NAME,
      email: seed.SEED_OWNER_EMAIL,
      passwordHash: await passwordHash(seed.SEED_OWNER_PASSWORD),
      role: role!._id,
    });
    console.log('Owner created. Use the credentials in your local .env file.');
  } else console.log('Owner exists; password and role left unchanged.');
  await Promise.all([User.init(), Role.init()]);
  console.log('Six staff roles seeded. No sales or financial records were fabricated.');
} finally {
  await mongoose.disconnect();
}
