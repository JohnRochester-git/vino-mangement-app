# Postmortem: game day outage, November 15, 2026

**Severity:** SEV1 (planned drill on the live site)
**Duration:** about 27 minutes of total outage (23:23 to about 23:50 UTC)
**Data impact:** none
**Status:** resolved; follow-up actions below

This is a blameless postmortem. It describes what our systems and processes allowed to happen, not who made a mistake.

## Summary

As a planned game day, we merged a deliberately broken change: the backend container told gunicorn to listen on port 8001 instead of 8000. CI passed, as expected. The deploy pipeline was meant to catch the problem with its smoke test and roll back automatically. Instead, the smoke test passed while the new image was only partly rolled out, the broken release was tagged as good, and no rollback ran. The site was fully down for about 27 minutes until it was restored by hand. No alert fired.

The drill showed the automatic safety net could be fooled by our own gradual rollout, and that our scheduled health check couldn't detect an outage in time. Both are now fixed or have follow-ups.

## Timeline

All times UTC (US Central in brackets).

| Time | Event |
| --- | --- |
| 23:17 (5:17 PM) | Pull request #38 ("Game day: wrong gunicorn port") merged. CI passed: the tests don't run the container image. |
| 23:18 | Deploy run 13 starts rolling out the broken image to half the containers first (gradual rollout). |
| ~23:18–23:23 | The smoke test passes. Some requests still reached old, healthy containers, and the smoke test stopped at its first passing attempt. Run 13 reported success and tagged the commit `v1.0.13` as a good release. **No rollback ran.** |
| 23:23 (5:23 PM) | The rollout completes. The site is fully down. The `/health` watcher shows a total failure, and that's how the outage was noticed. |
| 23:28 | A manual Health check run **passes**. Not yet explained (see below). |
| 23:33 | Confirmed down: requests return "Failed to start container: The container just exited". |
| 23:40 | The last good release, `v1.0.12`, is redeployed by hand from a laptop, with every container replaced at once (`--containers-rollout=immediate`). |
| 23:46 | The revert of the port change (#39) deploys through the pipeline as `v1.0.14`. |
| ~23:50 (5:50 PM) | The watcher shows `200` steadily again. |
| 23:52 | The smoke-test stability fix (#40) deploys as `v1.0.15`. |
| after | The broken tag `v1.0.13` is deleted locally and on GitHub. |

## Impact

- `www.vinowine.org` was fully unavailable for about 27 minutes: no pages that need the backend, no login, no API.
- No data was lost or changed. The database wasn't touched.
- Because `v1.0.13` was tagged as good, any failed deploy in the following minutes would have "rolled back" to the broken release. The tag was deleted before that could happen.

## What went wrong

**1. The smoke test was fooled by gradual rollout.** The Worker picks between two containers at random, and a rollout updates half of them first. The smoke test passed as soon as one attempt succeeded, which happened while half the traffic still reached healthy containers. In a test against a fake site failing half its requests, the old smoke test passed it 4 times out of 5.

**2. The fix existed but wasn't merged.** The gap had been found the same day, and a fix (`--stable-seconds`) was ready on a branch. The game day went ahead before it was merged. The drill had no checklist step to confirm its prerequisites were in place.

**3. A broken release was tagged as good.** Tagging depends only on the smoke test, so its false pass also corrupted the "last good release" the automatic rollback relies on.

**4. No alert fired.**
- **The scheduled health check didn't run during the outage.** GitHub started it at 14:50, 20:00 and 23:55 that day, not every 15 minutes. Scheduled GitHub workflows can't be relied on for timely monitoring.
- **A manual health check at 23:28 passed**, while the watcher showed a total failure from 23:23. Not yet explained: possibly the health check's longer timeout and retry let it reach a container that started briefly, or the run executed slightly earlier than its timestamp. To investigate.

## What went well

- **CI caught nothing, correctly.** The broken change passed every check, which is what a config mistake like this looks like in real life. CI does catch a broken health route: the backend tests check `/health`.
- **The watcher showed the outage the moment it became total.**
- **The manual restore worked first time,** following the runbook, and replacing every container at once avoided another half-finished rollout.
- **No data was at risk,** and the database was unaffected throughout.
- **The fix was deployed within minutes of the restore,** through the normal pipeline.

## Action items

| # | Action | Status |
| --- | --- | --- |
| 1 | Smoke test must keep passing for 3 minutes (`--stable-seconds 180`) before a deploy counts as good, including after a rollback | ✅ Done (#40, `v1.0.15`) |
| 2 | Delete the broken `v1.0.13` tag | ✅ Done |
| 3 | Revert the game-day change on `main` | ✅ Done (#39) |
| 4 | **Add an external uptime monitor** that checks often, from outside GitHub, alerting Discord | ✅ Done: Grafana Cloud Synthetic Monitoring, `/health` every 2 minutes and the API every 5, from 2 locations, alerting `#vino-alerts` |
| 5 | Make the health check harder to fool: check several times in a row, and fail if any attempt fails, instead of retrying once | Open |
| 6 | Investigate why the 23:28 manual health check passed | Open |
| 7 | Add a prerequisites step to future game days: confirm related fixes are merged and deployed first | Open |
| 8 | Repeat the game day once 4 and 5 are done, to confirm the automatic rollback and the alert both work | Open |
