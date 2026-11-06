import mongoose from 'mongoose';
import { readConfig } from './config.js';
import { connectDatabase } from './db.js';
import { User, Role } from './modules/auth/models.js';
import { seedDemoCatalog } from './modules/configuration/demo.js';
try {
  await connectDatabase(readConfig().MONGODB_URI);
  const ownerRole = await Role.findOne({ name: 'Owner' });
  const owner = ownerRole && (await User.findOne({ role: ownerRole._id, active: true }));
  if (!owner) throw new Error('Run npm run seed before adding demo catalog data.');
  await seedDemoCatalog(owner.id);
  console.log(
    'Demo menu, modifiers and floor added. Existing matching records were not overwritten. No orders or sales were created.',
  );
} finally {
  await mongoose.disconnect();
}
