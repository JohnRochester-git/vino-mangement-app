# Recovery targets

How much data we could lose (RPO) and how long the app could be down (RTO) in each failure, and what those numbers are based on. **Targets are proposed until agreed by the team.** Measured times come from drills; the database drills are scheduled for Sprint 6.

## Definitions

- **RPO (recovery point objective):** the most data we accept losing, measured as time.
- **RTO (recovery time objective):** the longest we accept the app being down.

## Targets

| Failure | RPO (target) | RTO (target) | How we recover |
| --- | --- | --- | --- |
| Bad deploy, Worker or pages | None | 10 minutes | Automatic: Worker rollback within seconds |
| Bad deploy, backend | None | 15 minutes | Automatic: Worker rollback, then redeploy of the last good release |
| Bad data change, for example a wrong migration or mass delete | 5 minutes | 1 hour | D1 Time Travel restore to just before the change |
| D1 database lost or unusable | 30 hours | 2 hours | Restore the latest nightly export from R2 into a new database |
| Cloudflare account or platform rebuilt | 30 hours | 4 hours | Rebuild from code (Terraform, Wrangler), then restore data from R2 |
| Cloudflare-wide outage | None | Accepted | Wait for Cloudflare. A single provider is an accepted risk for a prototype |

## What the targets are based on

**Backups.** The export job is scheduled nightly at 07:00 UTC. GitHub delays scheduled jobs when busy: on Nov 11 it started almost 8 hours late. A day plus that delay gives the 30-hour RPO for anything restored from R2, and the same 30 hours is the health check's missing-backup alert.

**Time Travel.** D1 keeps a point-in-time history for 30 days on the Workers Paid plan, so a bad change can be undone to within minutes. The 5-minute RPO allows for knowing roughly when the change happened.

**Deploys, measured:**

| What | Measured | Source |
| --- | --- | --- |
| Worker rollback taking effect | Seconds | Rollback drill, Nov 13 |
| Container live after a redeploy | About 1.5 minutes | Rollback drill, Nov 13 |
| Automatic rollback after a failed smoke test | About 5 minutes | Deploy run 1, Nov 12 |
| Automatic rollback with redeploy of the last good release | About 6 minutes | Deploy run 6, Nov 13 |

The 10- and 15-minute RTOs allow for the smoke test's 5-minute retry window plus the rollback steps.

**Still to measure in Sprint 6:**
- D1 Time Travel restore on the test database (against the 1-hour RTO)
- Restoring a nightly export into the test database (against the 2-hour RTO)
- Rebuild from code (nice-to-have; against the 4-hour RTO)

## Where the backups are

| What | Where | Kept |
| --- | --- | --- |
| Nightly exports | R2 bucket `vino-backups`, under `vino-db/` | Until deleted (a lifecycle rule is a deferred nice-to-have) |
| Point-in-time history | D1 Time Travel | 30 days |
| Infrastructure | This repository (`infra/`, `worker/`) | Git history |
| Terraform state | R2 bucket `vino-terraform-state` | No versioning |
