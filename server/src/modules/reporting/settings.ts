import mongoose, { Schema } from 'mongoose';
import { z } from 'zod';
export const settingsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    timezone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid IANA timezone'),
    receiptFooter: z.string().trim().max(300),
  })
  .strict();
export const RestaurantSettings = mongoose.model(
  'RestaurantSettings',
  new Schema(
    {
      _id: String,
      name: { type: String, default: 'Gather Restaurant' },
      timezone: { type: String, default: 'Asia/Colombo' },
      receiptFooter: { type: String, default: 'Thank you for dining with us.' },
      version: { type: Number, default: 0 },
    },
    { timestamps: true, versionKey: false },
  ),
);
export async function getRestaurantSettings() {
  return (
    (await RestaurantSettings.findById('restaurant').lean()) || {
      name: 'Gather Restaurant',
      timezone: 'Asia/Colombo',
      receiptFooter: 'Thank you for dining with us.',
      version: 0,
    }
  );
}
