# Phase 2 — Menu and floor management

## Upgrade an existing Phase 1 workspace

From `restaurant-pos`, with your MongoDB replica set running:

```powershell
npm run migrate:phase2
npm run dev
```

If the development server is already running, leave it running; its watcher reloads the code. Sign out and back in to refresh the navigation and permission list. The migration adds Phase 2 permissions to the six named built-in roles and creates indexes. It does not reset passwords, replace existing permissions, or modify business records. For a fresh installation, `npm run seed` already uses the updated role definitions; run the migration as well to initialize configuration indexes before first use.

Optional sample data:

```powershell
npm run seed:demo
```

This adds three categories, two modifier groups, six menu items, one floor and six tables, without replacing existing matching records. It creates no orders or sales. It is deliberately separate from the upgrade so a restaurant can start with its own menu. Do not repeatedly use demo seeding to manage a real catalog; it is a setup aid, not a reconciliation mechanism.

## Features

- **Menu collection:** searchable, paginated menu cards, category/availability filters, sorting, HTTPS image URLs, preparation station labels, exact two-decimal price input and availability controls.
- **Categories:** create, edit, reorder and archive, with normalized active-name uniqueness.
- **Modifiers:** stable option IDs, nonnegative additional prices, unique choices, minimum/maximum selection rules, and assignments to menu items.
- **Floors:** create, edit, order and archive service areas.
- **Tables:** globally unique names, capacities, square/round shapes, and an eight-column by six-row floor grid. Positions are edited through row/column fields, including moving an available table to another floor.
- **Service status:** available, reserved and occupied, with server-validated transitions and accessible status text in addition to colors.
- **Real-time updates:** authenticated, permission-checked Socket.IO invalidations after successful commits. Screens refetch on reconnect and every 30 seconds as a recovery measure; MongoDB remains authoritative.

## Permissions

| Role                           | Menu          | Floor/table configuration | Table status |
| ------------------------------ | ------------- | ------------------------- | ------------ |
| Owner, Manager                 | Read and edit | Read and edit             | Change       |
| Cashier, Waiter                | Read          | Read                      | Change       |
| Kitchen Staff, Inventory Staff | Read          | No access                 | No access    |

The backend checks permissions for each REST request and each outgoing change notification. Client visibility is not authorization. New permissions are `menu:read`, `menu:write`, `tables:read`, `tables:write`, and `tables:operate`.

The general API allowance defaults to 600 requests per IP per minute, configurable through `API_RATE_LIMIT_PER_MINUTE` (60–6000). This accommodates synchronized screens sharing a restaurant's network. Password login retains its separate limit of 10 attempts per 15 minutes.

## Integrity rules

Every update, archive or status change requires the record's current integer `version`. Successful writes increment it; stale writes return HTTP 409. The editor retains its original version so a background refresh cannot silently legitimize stale edits. Close and reopen the editor after a conflict.

Catalog/dining writes and audit entries commit in one MongoDB transaction. A singleton configuration revision is written first to serialize these low-volume management operations. This prevents write skew between concurrent reference creation and archiving. The driver retries transient transaction conflicts; application version conflicts are returned to the client. This gate is intentionally for configuration, not future order/payment traffic.

Categories and modifier groups cannot be archived while an active menu item references them. Floors cannot be archived while active tables reference them. A reserved or occupied table cannot be edited, moved, or archived. A table can move only when available, and its destination cell must be free. Unique database indexes back up these application checks.

Allowed status transitions:

```text
AVAILABLE -> RESERVED or OCCUPIED
RESERVED  -> AVAILABLE or OCCUPIED
OCCUPIED  -> AVAILABLE
```

Money is stored as integer minor units. The editor converts decimal text exactly rather than multiplying floating-point values. The current display currency remains LKR; restaurant currency settings belong to the later settings phase.

## APIs and code

- `/api/v1/catalog/categories`
- `/api/v1/catalog/modifier-groups`
- `/api/v1/catalog/menu-items`
- `/api/v1/dining/floors`
- `/api/v1/dining/tables`
- `/api/v1/dining/tables/:id/status`

Collection routes support GET and POST. Record routes support GET, PUT and DELETE (archive). Status uses PATCH. List responses are `{data: {items, pagination: {page, limit, total}}}`; mutations return `{data: record}`. Zod payloads are strict. Server-derived IDs, audit actors, versions and status defaults cannot be supplied through creation payloads.

The shared configuration module owns validation and DTO types. The server configuration module separates routes, controllers, transactional services, model access and Mongoose schemas. The client configuration feature contains menu and dining screens, editors and query helpers.

Run `npm run docs:api` to regenerate `docs/openapi.json` from the shared schemas. It is the current API contract; `docs/openapi.yaml` is the retained Phase 1 reference.

## Verification commands

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run build
```

API tests use isolated temporary replica sets. Browser tests use ports 4100/5174 and a separate seeded database, preserving the development app and real restaurant data. Tests cover validation, roles, reference integrity, archive/create races, duplicate positions, version conflicts, audit rollback, socket delivery and multi-terminal workflows.

## Phase boundary

Table status is manual until Phase 3. This phase does not create orders, assign checks to tables, merge/split bills, consume stock, route kitchen tickets, or process payments. Preparation stations are labels ready for the kitchen module. Print queues, configurable taxes, inventory recipes, and business reporting remain in their scheduled phases. No financial figures are fabricated.

The floor plan is a bounded grid with coordinate editing, not a drag-and-drop architectural drawing tool. Real-time invalidation currently targets a single API process; horizontal scaling will require a shared Socket.IO adapter/event bus.
