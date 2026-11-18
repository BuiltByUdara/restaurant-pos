# Phase 7: reporting, staff and restaurant settings

## Using the application

Run the existing launcher or npm run dev. No new environment variables or seed reset are required. MongoDB must remain a replica set for transactional writes.

- Dashboard: date filters, Today / Last 7 days / This month presets, cash collection, refunds, net cash, average completed order, tax, discounts, hourly bars, recent payments and low stock. Refresh manually or wait for the 30-second refresh.
- Reports: the same overview plus cashier totals, stock movements and closed-shift reconciliation. Each table exports quoted UTF-8 CSV; formula-leading cells are escaped. Charges also have a CSV export.
- Your team: create accounts, change name/email/role, reset passwords and deactivate accounts. Passwords require at least 14 characters. Editing revokes that account's sessions; editing yourself requires signing in again.
- Settings: restaurant name, IANA timezone and receipt footer. These settings appear on receipts and determine report calendar days.

## Report definitions

All money fields ending in Minor are integer LKR minor units (100 = LKR 1). Summary cards and hourly bars format LKR amounts; table and CSV column names identify raw minor units.

Cash and refunds use their ledger creation dates. Net cash subtracts refunds from collected payments. Product quantity and gross revenue use completed orders and their completion history dates; gross includes modifiers but excludes bill discounts, tax and service. Charges and average order value use completed bill snapshots. Refunds are separate and are not allocated across products/categories. New order lines snapshot category IDs; older lines without this field are shown as Uncategorized legacy snapshot. Category names reflect current catalog labels.

Order counts describe orders created in the date range, grouped by their current status; active counts therefore are not a historical end-of-day balance. Low stock reflects current inventory (first 50), not historical inventory. Recent payments show the latest 20 within the selected range. Shifts use closing dates. All date filters use inclusive restaurant-local days, including daylight-saving transitions, with a maximum 367-day range.

## Access and data integrity

Reports require reports:read; Dashboard requires dashboard:read. Dashboard omits detailed cashier, stock movement and shift datasets. Settings updates require settings:write. Staff mutations require staff:read and staff:write. Non-owners cannot manage owners or grant permissions they do not possess. Self-deactivation, self-role changes and removal of the last active owner are blocked.

Staff and settings writes use transactions, optimistic versions and audit records. Stale updates return 409. Password hashes never appear in staff API responses. Existing sessions are revoked on staff edits.

API routes are documented in openapi.json: GET reporting/sales, GET reporting/dashboard, GET/PUT reporting/settings, POST staff and PUT staff/:id, all under /api/v1.

## Scope and remaining work

This phase uses the existing cash ledger. Card acceptance still requires a processor integration. CSV is supported; PDF exports, employee rota scheduling, PIN login, physical printer/device integrations and Phase 8 operational hardening are not included. Reports aggregate source records at request time; large production datasets will need performance benchmarking and indexed date bounds or materialized summaries. Reporting refreshes periodically rather than using live event subscriptions. Do not reset or reseed a live database to enable these screens.
