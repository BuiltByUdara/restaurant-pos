# Phase 8 verification — 2026-11-18

## Passed locally

- TypeScript checks across all workspaces.
- All 60 backend/domain tests across nine files, including new production configuration, readiness/draining, malformed/oversized body and origin checks.
- All 11 Playwright journeys through npm run test:e2e: ten existing journeys and the reporting journey in separate automatically managed fresh-server batches. Production login rate limits remain unchanged.
- npm run build, including compiled API, bootstrap and migration entry points, and the frontend release bundle.
- Compiled-runtime smoke test: isolated owner bootstrap, API startup, replica-set readiness, rejection of unauthenticated staff access and successful owner login.
- Backup/restore drill using MongoDB Database Tools 100.20.1 and two disposable MongoDB 7.0.24 replica sets: financial values, unique index, session exclusion, occupied-target refusal, acknowledgement requirement and checksum rejection.
- npm audit --omit=dev reported zero vulnerabilities at the time of this check. This is not a guarantee against undisclosed vulnerabilities.
- Production Compose configuration rendered successfully using placeholder external paths/origin. No real secrets were printed or deployed.
- Git whitespace checks passed.

## Verification boundaries

Docker Desktop's Linux engine was unavailable. Container builds/startup, Nginx runtime validation, real certificates and an authenticated production database were not exercised locally. The new GitHub Actions workflow includes Docker image builds, Nginx validation and an evaluation-stack startup/HTTP smoke test, but has not run on GitHub yet. Production HTTPS and certificate/secret access still need operator acceptance testing.

The compiled-runtime test ran in test mode on a disposable database. Windows process termination does not establish Linux graceful-drain behavior under live load. Production startup constraints are covered by configuration tests, not a live TLS deployment test.

Vite still reports a non-blocking bundle-size warning and dependency annotation warnings. Backup archives are not encrypted by the wrapper; storage encryption and off-host retention are operational requirements. Existing financial records and development database contents were not seeded, reset or restored.

See phase-8.md for setup, recovery instructions and the remaining product gaps. Changes are local until explicitly committed/pushed.
