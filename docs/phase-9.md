# Phase 9: print queue, split/merge and pilot preparation

## Order workflows

Owners and managers can use **Point of sale → Details → Split or merge unpaid orders**. Select quantities to move to a new order, leaving at least one item on each side. The new order keeps the original status and customer name but has no table; the original retains its table. Use the existing table-transfer selector to assign another available table if needed.

For merging, open the destination order and choose a source from the current history page. Both orders must have the same status. The destination keeps its table and receives the source's price/modifier snapshots. The source is closed as CANCELLED with a merged_into history entry, and its table is released. The original source record is retained for audit/history. Separate lines are retained rather than combining potentially different modifiers or notes.

Only OPEN or SERVED orders with no payments and no saved bill adjustments are eligible. Orders being prepared cannot be restructured. Apply discounts, tax and service charges after splitting/merging. Both operations require orders:write and orders:approve, validate optimistic versions, share the transaction gate with payments/table changes and create audit records. Limits remain 100 lines and 100,000,000 minor units per order. Retrying a successful operation with an old version returns a conflict rather than repeating it.

OPEN orders consume stock when subsequently submitted, as before. SERVED orders have already consumed stock; splitting/merging them makes no inventory or kitchen-ticket writes. Original kitchen tickets remain fulfillment history. Served split bills can be paid separately without resubmitting kitchen work. Product reporting uses the eventual completed bill lines.

## Durable browser printing

Cashier bill details provide **Queue receipt**, with 58 mm/80 mm width selection. Kitchen cards provide **Queue kitchen ticket** at 80 mm. The **Print queue** navigation lists the current staff member's jobs, twenty per page. Jobs and their immutable text snapshots survive browser reload and server restart. Receipts include the restaurant name, order/table, prices and modifiers, subtotal/discount/tax/service/total, cash payment details, balance, refunds, local timestamp and footer. Kitchen snapshots include quantities, station, modifiers and preparation notes.

Queue requests use UUID request keys. Reusing a key with different parameters is rejected. Reprints use the saved snapshot; queue a new document when current order/payment details are wanted. Print jobs do not accept HTML or client-calculated totals.

**Open print dialog** atomically claims a queued job for five minutes. Competing tabs cannot claim it at the same version. States are QUEUED → PRINTING → DIALOG_OPENED or FAILED. Confirm paper output records **Staff confirmed**, not hardware verification. Retry requeues a failed/dialog-opened/confirmed job after a duplicate-print warning. An interrupted PRINTING job can be retried only after its claim expires; stale completion tokens cannot update the retried job. Attempts are counted. There is no automatic physical retry, since a browser cannot distinguish cancelled dialogs from successful printing and silent retries could produce duplicates.

The browser printer implements the existing ReceiptPrinter adapter interface. No ESC/POS, USB, network printer, cash drawer or payment terminal integration is claimed. A printer model and trusted local print agent will be needed for unattended output. No restaurant logo is configured yet. The old billing print endpoints remain for old clients, but cannot mutate the new leased jobs. Old jobs without document snapshots do not appear in the new queue; generate a new snapshot from the bill instead.

## API additions

All routes require authentication under /api/v1:

- POST orders/:id/split: version, quantities (one integer per source line).
- POST orders/:id/merge: version, sourceId, sourceVersion.
- GET printing?page=1: current actor's permitted jobs; lease tokens are omitted.
- POST printing: orderId, kind RECEIPT/KITCHEN, width 58/80, requestKey UUID.
- POST printing/:id/claim, /retry, /confirm: version.
- POST printing/:id/finish: leaseToken and status DIALOG_OPENED/FAILED.

Receipt jobs require payments:write; kitchen jobs require kitchen:read. This permission is rechecked on every operation. A user cannot operate another user's jobs. Jobs are queued manually; saving/submitting/paying an order does not automatically print.

## Deployment and pilot status

The Phase 8 GitHub [verification run](https://github.com/BuiltByUdara/restaurant-pos/actions/runs/44256474505) passed, including Docker image builds, Nginx validation and evaluation-stack startup/HTTP checks. That evidence applies to commit dc82a65, not these unpushed changes. Local Docker remains unavailable. No production domain, database host, payment processor or printer has been selected. Live HTTPS deployment and physical restaurant acceptance therefore remain pending. Card acceptance stays disabled.

Use the [pilot checklist](phase-9-pilot.md) when those resources are available. Do not use test credentials, fabricated payments or a development database as a live production rollout.
