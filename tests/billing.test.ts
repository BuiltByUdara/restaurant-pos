import { expect, it } from 'vitest';
import { calculateBill, calculateCashPayment, reconcileCash } from '../shared/src/billing';
it('calculates discounted subtotal, service and tax with integer half-up rounding', () => {
  expect(calculateBill(10000, { discountMinor: 1000, serviceBasisPoints: 1000, taxBasisPoints: 1800 })).toMatchObject({ serviceMinor: 900, taxMinor: 1782, totalMinor: 11682 });
  expect(calculateBill(5, { taxBasisPoints: 1000 }).taxMinor).toBe(1);
});
it('rejects excessive discounts, fractional money and unsafe totals', () => {
  expect(() => calculateBill(100, { discountMinor: 101 })).toThrow();
  expect(() => calculateBill(1.5, {})).toThrow();
  expect(() => calculateBill(100_000_000, { taxBasisPoints: 1 })).toThrow();
});
it('supports partial cash payments and change without over-crediting the order', () => {
  expect(calculateCashPayment(1000, 400, 500)).toEqual({ amountMinor: 400, tenderedMinor: 500, changeMinor: 100, remainingMinor: 600 });
  expect(() => calculateCashPayment(1000, 1001, 1001)).toThrow();
  expect(() => calculateCashPayment(1000, 400, 399)).toThrow();
  expect(() => calculateCashPayment(1000, 0, 0)).toThrow();
});
it('reconciles refunds, drawer movements and counted cash', () => {
  expect(reconcileCash({ openingMinor: 1000, paymentsMinor: 5000, refundsMinor: 500, cashInMinor: 200, cashOutMinor: 300, countedMinor: 5300 })).toEqual({ expectedMinor: 5400, countedMinor: 5300, differenceMinor: -100 });
});
