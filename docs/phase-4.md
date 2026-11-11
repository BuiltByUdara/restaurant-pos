# Phase 4 — Kitchen display

Restart the application with `npm run dev` or Start POS.cmd and open **Kitchen**. Owner, Manager and Kitchen Staff have kitchen access. Existing role permissions are sufficient; no reseeding is needed. Startup creates the unique ticket index and idempotently recovers missing tickets for existing SUBMITTED, PREPARING and READY orders. It preserves existing tickets and uses stored order snapshots, with Kitchen as the station fallback for older records.

Submitting an order creates one durable kitchen ticket in the same MongoDB transaction. Duplicate/stale submissions cannot create extra tickets. Tickets contain quantities, preparation notes, modifier names, station names, table name and the order identifier, but no prices or customer names.

Kitchen staff select **Start preparing**, then **Mark ready**. Service staff mark READY orders SERVED from POS; served tickets appear in Completed tickets. Manager voids also close tickets, clearly marked VOIDED. Transfers update the ticket table label. POS preparation controls remain synchronized with the kitchen screen.

Station names are configured on menu items and snapshotted into orders. Station filtering selects whole orders containing that station. All lines remain visible and actions apply to the whole ticket; independent per-station readiness is not implemented. The screen explicitly explains this behavior. Active tickets sort oldest first; history sorts newest first. Both are paginated with 30 tickets per page. Elapsed minutes refresh each second and stop at closure in history.

REST/database records are authoritative. Authenticated Socket.IO invalidations refresh kitchen, order and floor data after commits. Every outgoing notification rechecks current permissions. Reconnect invalidates cached kitchen data, and a 15-second refresh recovers missed events. Versions reject stale concurrent changes. Order and ticket updates plus audit logs commit atomically. Kitchen clients cannot void, serve or complete tickets through the kitchen API.

## API

- `GET /api/v1/kitchen?page=1&history=false&station=Kitchen`: requires `kitchen:read`; returns `{items, stations, pagination}` under `data`. Omit station for all stations. History contains served and voided tickets.
- `PATCH /api/v1/kitchen/:id/status`: requires `kitchen:write`; strict body `{version, status}` where status is PREPARING or READY. Returns the persisted ticket under `data`. Invalid transitions or stale versions return 409.
- `kitchen:changed`: server-to-client notification, restricted to `kitchen:read`; clients refetch REST data.

Phase 5 payments, receipts, refunds and cashier shifts remain unimplemented. Kitchen completion means food has been served, not that payment has been collected. No printing or external hardware integration is claimed.
