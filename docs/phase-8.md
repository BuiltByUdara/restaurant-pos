# Phase 8: hardening, deployment and recovery

## Delivered

- Production configuration rejects HTTP browser origins, missing MongoDB authentication, missing replica-set configuration and insecure TLS options. URI and signing-secret files are supported with MONGODB_URI_FILE and JWT_SECRET_FILE; do not set both a value and its file variant.
- Startup checks for a writable MongoDB replica set before accepting traffic. This catches the standalone MongoDB transaction failure encountered earlier. Authentication indexes are initialized before listening.
- GET /api/v1/live reports process liveness. GET /api/v1/health probes MongoDB and returns 503 for disconnected, non-primary or draining instances. Health probes do not consume the application rate limit.
- Shutdown marks the API unavailable, rejects new application requests and closes sockets/HTTP before disconnecting MongoDB, with a ten-second deadline. HTTP request/header timeouts are explicit.
- Production Compose uses HTTPS at Nginx, secret files, an external authenticated TLS replica set, a non-root API runtime, read-only API filesystem, dropped capabilities, bounded logs and health-based startup ordering. The API and database have no published ports.
- The API image excludes development dependencies; bundled bootstrap/migration commands remain available.
- Backup/restore tools, an isolated recovery drill, backend hardening tests and GitHub Actions checks are included. Browser tests run in two fresh-server batches to retain the real ten-login throttle.

## Local operation

Existing local setup and Start POS.cmd continue to work. No database reset is required. Use npm run typecheck, npm test, npm run test:e2e, npm run build and npm run format:check. Dependency checks use npm audit --omit=dev. Tests never seed or clear the restaurant database.

## Production deployment runbook

This is a single-API-process deployment. Rate limits live in process memory; add a shared rate-limit store and Socket.IO coordination before scaling horizontally. A single-node replica set supports transactions but is not highly available.

1. Provision a MongoDB replica set with authentication, TLS and backups. Give the application a dedicated database user, restricted to that database, and restrict network access to the API/management host. The application URI must select the restaurant database explicitly. Keep administrative backup credentials separate.
2. Provision a DNS name and trusted TLS certificate. Put the certificate chain, private key, random signing secret (at least 48 characters), and credential-bearing MongoDB URI in restricted files outside the checkout. On Windows, apply account-specific ACLs; POSIX file modes alone do not protect Windows files.
3. Set CLIENT_ORIGIN to the exact HTTPS origin, without trailing slash. Set JWT_SECRET_FILE, MONGODB_URI_FILE, TLS_CERT_FILE and TLS_KEY_FILE to absolute host paths. Compose mounts the two application secrets at /run/secrets. On Linux, make their source files readable by container UID 1000 with restricted ownership/mode; Compose file-backed secrets retain host permissions. Never point it at development .env credentials.
4. Validate and build:

```powershell
docker compose -f deploy/compose.production.yml config --quiet
docker compose -f deploy/compose.production.yml up -d --build
```

5. Bootstrap the owner only on a new database. Supply SEED_OWNER_NAME, SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD through a protected management environment; do not place the password in shell history. Run:

```powershell
docker compose -f deploy/compose.production.yml exec -e SEED_OWNER_NAME -e SEED_OWNER_EMAIL -e SEED_OWNER_PASSWORD server node server/dist/seed.js
```

Remove those bootstrap environment variables afterward. The seed preserves existing owner passwords, but refreshes built-in role permissions; do not run it as an automatic application startup task. Phase 2 migrations remain available as node server/dist/migrate-phase2.js.

6. Verify HTTPS readiness, sign-in, refresh after reload, authorized/restricted routes, kitchen updates, a test cash sale/refund, receipt preview and shift reconciliation. Check certificate expiry and database health monitoring. Confirm internal ports cannot be reached by client devices. Validate a restore before taking real orders.

Upgrade during a maintenance window: stop application writers, take a verified backup, record the current Git commit/image identifiers, build the release, start it and run smoke checks. Retain the previous images. Roll back the image only if its data contract is compatible; otherwise restore to an isolated database and switch after verification. Never overwrite the only copy of restaurant data. Nginx must remain the one trusted proxy directly in front of the API; it replaces incoming forwarded IP headers.

## Backup and restore

Install the official MongoDB Database Tools and put mongodump/mongorestore on PATH, or set MONGODUMP_BIN and MONGORESTORE_BIN to their absolute executable paths. The workflow follows the official [mongodump documentation](https://www.mongodb.com/docs/database-tools/mongodump/) and [Database Tools installation guide](https://www.mongodb.com/docs/database-tools/installation/).

Create a protected JSON config outside version control containing only a uri property with an explicit application database. JSON is accepted by the tools' YAML config reader. Credentials are passed by config file, not command-line URI, and native tool errors are not echoed by the wrapper.

This is an **offline application-database backup**. Stop every API process, worker and external writer for the whole dump. The acknowledgement flag does not stop them for you. Equal document counts detect some accidental writes, but cannot prove quiescence or detect every in-place update. MongoDB TTL cleanup can still occur; sessions are excluded. The application has no other TTL business collections.

```powershell
# Stop the app; keep MongoDB running. Parent backup directory must exist.
npm run backup -- C:/private/backup-source.json C:/private/backups/2026-11-18 --writes-stopped
```

The output directory must be new. A successful backup contains database.archive.gz and a manifest with database name, collection counts, creation time and SHA-256. A missing manifest means incomplete backup. The checksum detects corruption, not malicious tampering; protect both files. Archives contain sensitive data and password hashes and are **not encrypted by this script**. Use encrypted storage and encrypted off-host copies, with restricted ACLs and retention appropriate to restaurant needs. Monitor scheduled backup exit codes. Keep daily copies and perform regular recovery drills; choose RPO/RTO with the operator. For online backups use the database provider's verified snapshot/PITR workflow rather than this offline command.

Restore to a separate, empty replica set with the same application database name. The application must remain stopped. The tool refuses any target that already has collections, verifies the checksum before connecting, imports only that database, checks restored counts and excludes sessions so previous logins cannot resume.

```powershell
npm run restore -- C:/private/restore-target.json C:/private/backups/2026-11-18 --writes-stopped
```

If restore fails, keep its partially populated target isolated and use a newly provisioned empty target for retry. The tool never drops or cleans an existing database. Database users, replica-set configuration, TLS material and application secrets are not part of this application-data archive; provision them separately. Verify payment totals, orders, inventory, indexes, owner access and reports before switching the application URI.

Run npm run test:backup for an isolated drill with two temporary replica sets. It verifies business values, a unique index, session exclusion, refusal to overwrite and checksum rejection. It does not read .env or connect to restaurant data.

## Remaining product and deployment boundaries

Phase 8 completes this hardening/tooling scope; it does not certify a live deployment. Docker runtime/TLS verification requires a running engine and actual certificates/database credentials. Card acceptance remains disabled until a processor is specified and verified. Physical printers, durable print retry queues, item-level bill splitting/merging and optional PIN/customer workflows remain product gaps from the original broader wishlist. Browser receipt printing and partial cash payments are available. Reporting has the limitations documented in Phase 7. These gaps must not be presented as completed integrations.
