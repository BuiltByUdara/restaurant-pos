import { z } from 'zod';

export const orderStates = [
  'OPEN',
  'SUBMITTED',
  'PREPARING',
  'READY',
  'SERVED',
  'COMPLETED',
  'CANCELLED',
  'VOIDED',
] as const;
export type OrderState = (typeof orderStates)[number];
const money = z.number().int().min(0).max(100_000_000);
export const orderLineSnapshotSchema = z
  .object({
    menuItemId: z.string().regex(/^[a-f\d]{24}$/i),
    name: z.string().trim().min(1).max(120),
    station: z.string().max(80).optional(),
    unitPriceMinor: money,
    quantity: z.number().int().min(1).max(99),
    modifiers: z
      .array(
        z
          .object({
            optionId: z.string().uuid(),
            name: z.string().trim().min(1).max(120),
            priceMinor: money,
          })
          .strict(),
      )
      .max(48),
    notes: z.string().trim().max(500),
  })
  .strict();
export type OrderLineSnapshot = z.infer<typeof orderLineSnapshotSchema>;

// This accepts server-resolved snapshots, never trusted client prices.
export function calculateOrderTotals(input: unknown) {
  const lines = z.array(orderLineSnapshotSchema).min(1).max(100).parse(input);
  const lineTotals = lines.map(
    (line) =>
      (line.unitPriceMinor + line.modifiers.reduce((sum, option) => sum + option.priceMinor, 0)) *
      line.quantity,
  );
  const subtotalMinor = lineTotals.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor > 100_000_000)
    throw new Error('Order exceeds the supported total.');
  return { lineTotals, subtotalMinor };
}

const transitions: Record<OrderState, readonly OrderState[]> = {
  OPEN: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PREPARING', 'VOIDED'],
  PREPARING: ['READY', 'VOIDED'],
  READY: ['SERVED', 'VOIDED'],
  SERVED: ['COMPLETED', 'VOIDED'],
  COMPLETED: [],
  CANCELLED: [],
  VOIDED: [],
};
export function assertOrderTransition(
  from: OrderState,
  to: OrderState,
  context: { managerApproved: boolean; paymentSettled: boolean },
) {
  if (!transitions[from]?.includes(to)) throw new Error('Invalid order status transition.');
  if (to === 'VOIDED' && !context.managerApproved) throw new Error('Manager approval required.');
  if (to === 'COMPLETED' && !context.paymentSettled) throw new Error('Confirmed payment required.');
}
