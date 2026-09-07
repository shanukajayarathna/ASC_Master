# ASC Master Rollback Runbook

This runbook rolls the application containers back to a previously published immutable image
pair. It does not perform a live rollback by itself and must be executed by the deployment owner
against the release host, never against a developer workstation or production data copy used for
testing.

## Preconditions

1. Identify the failed release's backend and frontend image digests and the last known-good pair.
   Roll back both images together; do not mix frontend and backend releases unless their contract
   compatibility has been explicitly checked.
2. Confirm the last known-good release can read the current Mongo documents and indexes.
3. Confirm whether the failed release wrote new fields or collections. The current in-flight
   Market Bulletin and server-side PDF work is uncommitted at the time of this runbook and needs
   a separate compatibility check before any release is approved.
4. Take a fresh backup of the named `asc-data` volume and record the backup path, timestamp, and
   image digests.

## Image rollback

From the repository revision that contains this runbook, run:

```powershell
.\deploy\rollback.ps1 `
  -BackendImage "registry.example/asc-master-backend@sha256:<known-good-digest>" `
  -FrontendImage "registry.example/asc-master-frontend@sha256:<known-good-digest>"
```

The script pulls the selected backend/frontend images, keeps Caddy in the Compose stack, starts
the pair with `--no-build`, and prints the resulting service status. Image digests are required in
the release record even if a human-readable tag is also used.

## `/data` backup and restore

The `asc-data` volume contains sale files, uploaded documents, lot media, and generated files that
Atlas does not protect. Before deployment and before rollback, create an off-host archive:

```bash
docker run --rm -v asc-data:/data -v /root/backups:/backup alpine \
  tar czf /backup/asc-data-$(date +%F-%H%M%S).tar.gz -C /data .
```

Restore is an operator-approved data operation. Stop the application containers, verify the chosen
archive checksum and target volume, extract the archive into the named volume, then start the
selected image pair. Do not overwrite the volume until the archive and target have been checked.

## Mongo compatibility gate

Before switching images, compare the failed release's Mongo writes with the previous release's
read models:

- every new field is optional or has a backward-compatible default;
- no collection or index required by the previous release was renamed or dropped;
- enum/string values written by the new release are understood by the previous release;
- migration versions already applied are safe for the previous release to encounter;
- the `_migrations` record for migration 001 only records the existing index baseline and does not
  change business document shape.

If the failed release introduced a backward-incompatible write, restore a Mongo backup or perform
a reviewed data transformation before starting the previous image. The rollback script does not
attempt that transformation.

## Post-rollback checks

1. Confirm `https://<site>/health` responds through Caddy.
2. Sign in with a smoke-test account.
3. Read one catalogue from `/data/sales` and one valuation-backed lot from MongoDB.
4. Open one report and verify that its generated output downloads.
5. Check logs for migration, authentication, file-store, and provider errors.
6. Record the final image digests, `/data` archive, Mongo compatibility decision, and test results
   in the incident record.
