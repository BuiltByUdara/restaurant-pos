# Restaurant pilot acceptance checklist

Record operator, date, application commit, browser/device, database host, printer model and results. This is a checklist for a future pilot, not a completed restaurant acceptance record.

## Deployment gate

- [ ] Exact HTTPS origin and trusted certificate work on all staff devices.
- [ ] Dedicated authenticated TLS replica set is reachable only by authorized services.
- [ ] Owner bootstrap completed; access, idle lock and role restrictions checked.
- [ ] Readiness monitoring, disk-space alerts and backup failure notifications configured.
- [ ] Encrypted off-host backup restored to an isolated database; business totals checked.
- [ ] Previous release/image and rollback decision documented.

## Service rehearsal

- [ ] Open a cashier shift and verify opening cash.
- [ ] Dine-in and takeaway orders survive reload and reach the correct kitchen station.
- [ ] Modifier selections, preparation notes and prices match menu expectations.
- [ ] Concurrent table assignment/edit attempts produce a conflict rather than double booking.
- [ ] Split selected items and merge compatible unpaid orders; totals remain conserved.
- [ ] Transfer an order and check floor/table changes on another terminal.
- [ ] Ingredient consumption occurs once at submission; served split/merge does not consume again.
- [ ] Partial cash payments, final payment, change, authorized refund and shift close reconcile.
- [ ] Queue receipt and kitchen snapshots, reload, print at actual paper width and inspect legibility.
- [ ] Cancel a print dialog, retry after checking duplicates, and confirm actual paper output.
- [ ] Close a tab during a print claim; verify recovery after five minutes and no stale update.
- [ ] Daily reports agree with the cash ledger in the restaurant timezone.
- [ ] Disconnect/reconnect a terminal and verify persisted orders/tickets are recovered.

## Hardware/payment gate

- [ ] Select printer and test real device output, margins, cutter and connectivity as applicable.
- [ ] Select payment processor; implement and test verified terminal status before enabling cards.
- [ ] Test processor timeouts, duplicate confirmations, failed payments and reconciliation.

Keep card acceptance disabled until its gate passes. Record unresolved defects and assign an operator decision before taking real service traffic.
