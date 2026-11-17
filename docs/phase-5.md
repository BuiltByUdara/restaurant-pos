# Phase 5 — Cash billing and cashier operations

Start with `npm run dev` (or Start POS.cmd), then open Cashier. Startup initializes payment, shift, movement and print-job indexes. No business data is seeded. MongoDB must be a replica set.

## Service workflow

1. Open your own cashier shift with the counted opening float.
2. Serve an order from POS. Select its bill to review the subtotal and outstanding balance.
3. Owner/Manager may apply a fixed discount and percentage tax/service charges before the first payment. Charges are snapshotted on the bill. Tax applies to discounted goods plus service; each charge rounds once, half up, in integer minor units. Rates are entered per bill rather than assumed from local tax law.
4. Select the served order and enter the amount to apply and cash received. Partial payments support splitting the total between diners; repeat until settled. Change is cash received minus the amount applied. The final payment completes the order and releases seating transactionally.
5. View bill/payment history and print a 58mm or 80mm receipt. Browser print dialogs do not confirm physical printing. Jobs record QUEUED, DIALOG_OPENED or FAILED; Print receipt can retry. A printer adapter is provided for future hardware integration.
6. Owner/Manager can refund all or part of an individual payment, with a required reason and an open shift. Refunds cannot exceed the original unrefunded payment, never reopen the order, and do not restore inventory. Refund cash is charged to the acting manager's current drawer, even when the original payment used an older shift.
7. Record reasoned cash-in/out movements. Close your own shift with actual counted cash. Expected cash is opening + applied cash payments − refunds + cash-in − cash-out; change is already excluded from applied payments. Closed shifts retain expected/count/difference records.

## Integrity

All financial writes use MongoDB transactions and audit records. Payment/refund/movement keys support retries without duplicating entries and reject reuse with different data. Version checks prevent stale payments or shift closures. Bills lock after payment. Orders with payments cannot be voided. Keep the cashier screen open while resolving uncertain requests and retry the same request; inspect the payment ledger before initiating a replacement request after a reload.

All billing routes require payments:write; adjustments additionally require orders:approve and refunds require refunds:approve. Actors can open/close only their own shifts. Manager shift override is deliberately unavailable. No raw card data is accepted or stored.

## API under /api/v1/billing

- GET/POST /shifts; POST /shifts/:id/close (`version`, `countedMinor`).
- GET /orders/:id returns stored order, bill, payments, refunds and balance.
- PUT /orders/:id/bill accepts version, discountMinor, taxBasisPoints, serviceBasisPoints.
- POST /payments/cash accepts orderId, version, amountMinor, tenderedMinor and UUID idempotencyKey.
- GET /payments?orderId=... returns the payment ledger.
- POST /refunds accepts kind REFUND, paymentId, amountMinor, reason and idempotencyKey.
- GET/POST /movements; writes accept kind IN/OUT, amountMinor, reason and idempotencyKey.
- GET/POST /print-jobs; PATCH /print-jobs/:id records browser dialog/failure status.

## Explicit boundaries

Card acceptance remains disabled until a processor/terminal and verification integration are supplied. Split payments here are amount-based cash installments, not item-level split/merge bills. Complimentary zero-total settlement is not supported. Printer dialogs and receipt layout are implemented; physical printers have not been tested. Restaurant branding is currently Gather Restaurant. Inventory deductions and stock reversals belong to Phase 6.

Run `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, and `npm run format:check`. Tests use isolated replica sets and do not write restaurant payments.
