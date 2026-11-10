# Phase 3 — POS and orders

Open **Point of sale** after starting the application with `npm run dev` or `Start POS.cmd`. Existing Phase 2 roles already contain order permissions; no credential reset or demo seed is required. The API initializes the order indexes on startup. MongoDB must be a replica set.

## Workflow

Search products or select a category, add items, choose modifiers, set quantities and preparation notes, and optionally enter a customer name. Choose a table for dine-in or Takeaway. The cart displays an estimate; Save order resolves current catalog prices and validates modifier limits on the server. Saved orders survive reloads. Multiple orders can remain open.

Open orders can be edited, submitted or cancelled. Editing recalculates all lines using the current menu; review the returned confirmed subtotal. Submitted snapshots are immutable. Order details show the stored names, prices, modifiers, notes and history. History is paginated in groups of 30. Table selectors transfer active orders transactionally and release the previous table.

The lifecycle is OPEN → SUBMITTED → PREPARING → READY → SERVED. OPEN can be CANCELLED. Owner/Manager approval permission permits VOIDED after submission. Terminal states cannot reopen. COMPLETED is deliberately rejected until a confirmed payment ledger is implemented in Phase 5. Submission persists the order only: kitchen ticket generation and kitchen display arrive in Phase 4. Current preparation controls let authorized order operators advance the lifecycle manually.

## Integrity and authorization

- REST reads require `orders:read`; mutations require `orders:write`. Voiding additionally checks `orders:approve` on the authenticated account; no client approval flag is accepted.
- Prices use integer minor units. Client-supplied prices and totals are rejected. Quantities are integers from 1 to 99; at most 100 lines and a maximum subtotal of 100,000,000 minor units are accepted.
- Mutations use MongoDB transactions and an audit record. Version checks reject stale edits and status changes. A shared write gate serializes menu snapshots and table assignment against configuration changes.
- Available or reserved tables can accept an order. Competing assignments cannot both succeed. Active-order tables cannot be manually released from the floor screen. Cancellation/void releases seating atomically.
- Authenticated, permission-checked change events invalidate orders and tables after commit. Polling and reconnect refresh recover missed notifications.
- Customer input is a per-order name, not a customer directory. Unsaved carts are in memory; save before navigating away or signing out.

## API

All routes are under `/api/v1/orders`:

- `GET /?page=1`: paginated order history with snapshots and lifecycle history.
- `GET /:id`: persisted order detail.
- `POST /`: `{lines, tableId, customerName}`. Each line contains `{menuItemId, quantity, optionIds, notes}`; tableId is null for takeaway.
- `PUT /:id`: the create body plus `version`; only OPEN orders can change.
- `PATCH /:id/status`: `{version, status}`.
- `PATCH /:id/table`: `{version, tableId}`.

Responses use `{data: ...}`; validation, permissions and conflict errors use the existing error envelope. Financial discounts, taxes, service charges, checkout, split bills, refunds and receipts belong to Phase 5. Order merging and splitting are not advertised in this release.

## Verification

Run `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`. Tests use isolated databases, not restaurant data. Order coverage includes exact arithmetic, immutable persisted snapshots, strict payload validation, stale edits, table assignment races, manual table release protection, rollback, lifecycle approval, payment gating and the save/reload/edit/submit browser journey.
