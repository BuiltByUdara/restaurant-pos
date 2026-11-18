# Phase 6 — Inventory

Start the app and open Inventory. Owner, Manager and Inventory Staff can read and write inventory; other built-in roles cannot. Startup creates inventory indexes. No existing orders are retroactively charged for ingredients, and no demo stock is added.

## Workflow

Create ingredients using whole grams (`g`), millilitres (`ml`) or individual units (`each`). Each starts at zero stock. A low-stock warning appears when stock is at or below its configured threshold. Receive opening stock with a positive RECEIVE movement, record loss with a negative WASTE movement, or correct a count using a signed ADJUST movement. A reason is required; the ledger records the actor, date, quantity and kind. Current stock and movement history are paginated.

Create suppliers with a name and contact. Build purchase lines, choose the supplier and create the order. Receive full order adds all lines atomically; cancelling adds no stock. Repeating the same receive request cannot add stock twice. Partial deliveries and purchase-cost accounting are not supported; create separate purchase orders for separately received deliveries.

Choose a menu item in the recipe editor before adding component lines. Quantities describe the amount of each ingredient per menu item. Save recipe validates references, rejects duplicate ingredient lines and checks the version originally loaded. Select the item again to reload after a conflict. Products without recipes remain explicitly untracked. Recipes currently cover base menu items, not additional modifier-specific ingredient usage.

## Consumption and concurrency

When an order transitions OPEN → SUBMITTED, the server reads current recipes, aggregates requirements across all order lines, deducts stock, writes movement entries and creates the kitchen ticket in the same transaction. Insufficient stock rolls everything back: the order remains OPEN and no kitchen ticket is created. Consumption entries are uniquely keyed by order and ingredient. A shared transaction gate serializes stock changes, recipe edits, catalog writes and submission.

Cancellation, voids and refunds never restore stock automatically. An authorized operator must record a reasoned adjustment when ingredients are actually recoverable. The movement ledger preserves what was deducted even if a recipe later changes.

Authenticated inventory notifications invalidate screens after successful changes and submissions. Permissions are rechecked for outgoing events. Reconnect refresh and periodic stock/history polling recover missed notifications. Stale manual stock changes return 409; re-open the ingredient before retrying. Receiving/movement keys reject conflicting duplicate requests.

## API under /api/v1/inventory

- GET ingredients, recipes, movements, suppliers, purchases: `{items, pagination}` inside `data`, 50 records per page.
- POST ingredients: `{name, unit, lowStock}`. Stock starts at zero.
- PUT recipes/:menuItemId: `{version, components:[{ingredientId, quantity}]}`; version is null on creation.
- POST movements: `{ingredientId, version, kind, delta, reason, key}`; key is a UUID.
- POST suppliers: `{name, contact}`.
- POST purchases: `{supplierId, lines:[{ingredientId, quantity}]}`.
- PATCH purchases/:id: `{version, status}` where status is RECEIVED or CANCELLED.

Reads require inventory:read and mutations inventory:write. Quantities must be integers and stock must remain between zero and 1,000,000,000 base units. No deletion or ledger rewriting is exposed. Existing ingredient units are immutable.

Run `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build` and `npm run format:check`. Tests use isolated databases; they do not seed or clear restaurant stock. Phase 7 adds dashboard/reporting and broader settings.
