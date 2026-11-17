import { z } from 'zod';
export const minorUnits = z.number().int().min(0).max(100_000_000);
export const billingRulesSchema = z
  .object({
    discountMinor: minorUnits.default(0),
    taxBasisPoints: z.number().int().min(0).max(10000).default(0),
    serviceBasisPoints: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
// Round each charge once, half up; tax applies to discounted goods plus service.
export function calculateBill(subtotal: number, input: unknown) {
  const subtotalMinor = minorUnits.parse(subtotal);
  const rules = billingRulesSchema.parse(input);
  if (rules.discountMinor > subtotalMinor) throw new Error('Discount exceeds subtotal.');
  const net = subtotalMinor - rules.discountMinor;
  const serviceMinor = Math.floor((net * rules.serviceBasisPoints + 5000) / 10000);
  const taxMinor = Math.floor(((net + serviceMinor) * rules.taxBasisPoints + 5000) / 10000);
  const totalMinor = minorUnits.parse(net + serviceMinor + taxMinor);
  return { subtotalMinor, ...rules, serviceMinor, taxMinor, totalMinor };
}
export function calculateCashPayment(balance: number, applied: number, tendered: number) {
  minorUnits.parse(balance);
  minorUnits.parse(applied);
  minorUnits.parse(tendered);
  if (applied === 0 || applied > balance)
    throw new Error('Payment must be positive and cannot exceed the outstanding balance.');
  if (tendered < applied) throw new Error('Cash tendered is insufficient.');
  return {
    amountMinor: applied,
    tenderedMinor: tendered,
    changeMinor: tendered - applied,
    remainingMinor: balance - applied,
  };
}
export function reconcileCash(input: {
  openingMinor: number;
  paymentsMinor: number;
  refundsMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  countedMinor: number;
}) {
  Object.values(input).forEach((value) => minorUnits.parse(value));
  const expectedMinor =
    input.openingMinor +
    input.paymentsMinor -
    input.refundsMinor +
    input.cashInMinor -
    input.cashOutMinor;
  if (!Number.isSafeInteger(expectedMinor))
    throw new Error('Cash balance exceeds supported precision.');
  return {
    expectedMinor,
    countedMinor: input.countedMinor,
    differenceMinor: input.countedMinor - expectedMinor,
  };
}
