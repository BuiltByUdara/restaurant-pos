import { describe, expect, it } from 'vitest';
import { calculateOrderTotals, assertOrderTransition } from '../shared/src/orders.js';

const line = {
  menuItemId: '123456789012345678901234',
  name: 'Lunch',
  unitPriceMinor: 10025,
  quantity: 3,
  modifiers: [{ optionId: '00000000-0000-4000-8000-000000000001', name: 'Extra', priceMinor: 75 }],
  notes: '',
};
describe('order domain', () => {
  it('calculates exact integer totals including per-unit modifiers', () => {
    expect(calculateOrderTotals([line])).toEqual({ lineTotals: [30300], subtotalMinor: 30300 });
  });
  it.each([0, -1, 1.5, 100])('rejects invalid quantity %s', (quantity) => {
    expect(() => calculateOrderTotals([{ ...line, quantity }])).toThrow();
  });
  it('rejects fractional money, empty orders and excessive totals', () => {
    expect(() => calculateOrderTotals([{ ...line, unitPriceMinor: 1.5 }])).toThrow();
    expect(() => calculateOrderTotals([])).toThrow();
    expect(() => calculateOrderTotals([{ ...line, unitPriceMinor: 100_000_000 }])).toThrow();
  });
  it('enforces lifecycle, manager approval and payment settlement', () => {
    const context = { managerApproved: false, paymentSettled: false };
    expect(() => assertOrderTransition('OPEN', 'SUBMITTED', context)).not.toThrow();
    expect(() => assertOrderTransition('OPEN', 'COMPLETED', context)).toThrow();
    expect(() => assertOrderTransition('SUBMITTED', 'VOIDED', context)).toThrow();
    expect(() => assertOrderTransition('SERVED', 'COMPLETED', context)).toThrow();
    expect(() =>
      assertOrderTransition('COMPLETED', 'OPEN', { managerApproved: true, paymentSettled: true }),
    ).toThrow();
  });
});
