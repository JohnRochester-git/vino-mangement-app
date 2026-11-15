# Restore drills

Two timed drills on November 15, 2026, proving the database can be recovered within the targets in [recovery-targets.md](../recovery-targets.md). Both used test data only: drill A ran on `vino-db-test`, and drill B restored into a temporary database. Times are UTC.

## Drill A: undo a bad data change with D1 Time Travel

**Scenario:** a bad `UPDATE` overwrites every user's first name.
**Target:** RTO 1 hour, RPO 5 minutes.

| Time | Step |
| --- | --- |
| 00:09:19 | Starting data checked: user 1, `test@test.com`, first name `test` |
| 00:09:26 | Restore point recorded (`2026-11-15T00:09:26Z`) |
| ~00:09:30 | The "accident": `UPDATE user SET userFname = 'CORRUPTED'`, confirmed in the table |
| 00:11:39 | Restore started: `wrangler d1 time-travel restore vino-db-test --timestamp 2026-11-15T00:09:26Z` |
| 00:11:45 | Restore done and data checked: first name back to `test` |

**Result:** recovered in **6 seconds** from starting the restore, to the exact restore point. The restore printed a bookmark for undoing the restore itself, so a wrong restore point can also be reversed.

**What to know:**
- A Time Travel restore replaces the **whole** database, including any good changes made after the restore point. In a real incident, pick the restore point carefully, and expect to re-enter anything added since.
- Always try it on `vino-db-test` first when there's time.

## Drill B: restore a nightly backup from R2

**Scenario:** the database is lost, and has to be rebuilt from the last nightly export.
**Target:** RTO 2 hours, RPO 30 hours.

| Time | Step |
| --- | --- |
| 00:13:52 | Downloaded the newest export, `vino-backups/vino-db/2026-11-14T1358Z.sql` (a first try failed on a typo in the file name) |
| 00:13:53 | Created a temporary database, `vino-db-restore-drill` |
| ~00:14 | Loaded the export: 129 statements, 288 rows written, about 0.19 MB |
| 00:15:43 | Checked against live: users 3 = 3, wines 3 = 3, inventory items 3 = 3 |
| after | Deleted the temporary database and the downloaded file (it contains password hashes) |

**Result:** restored and checked in **about 2 minutes**, with the data matching live exactly.

**What to know:**
- **Restore into a new database, not over an existing one.** The export creates every table, so loading it into a database that already has them fails.
- **To make a restored database live,** point the `DB` binding in `worker/wrangler.jsonc` at its ID and deploy.
- **Check the exact file name in R2.** Wrangler can't list a bucket's contents; use the dashboard or the backup run's log.
- **Wrangler offers to add a new database to `wrangler.jsonc`.** Answer **no** for temporary databases. During this drill it was accepted, and the config then pointed at a database that was deleted minutes later; the change was undone before it was committed.
- **The export was taken at 13:58 UTC, not 07:00.** GitHub started the scheduled job almost 7 hours late. That's within the 30-hour RPO, which allows for it.

## Evidence

Screenshots: drill A's corrupted and restored tables; drill B's two matching count tables.
