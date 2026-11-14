# Incident response

What to do when something breaks on www.vinowine.org: how we find out, how serious it is, and the steps to follow. Alerts go to Noah during the semester; there's no 24/7 on-call.

## How we find out

| Signal | What it means | Where |
| --- | --- | --- |
| 🚨 **Vino health check failed** in Discord `#vino-alerts` | The site, the API, the backup or the error rate failed a check. The message lists which | Health check workflow, every 15 minutes |
| 🚨 **Nightly D1 backup failed** in Discord | Last night's export didn't reach R2 | Backup workflow |
| GitHub email: a workflow run failed | Same as the two above, plus failed Deploy and Terraform runs | GitHub notifications |
| A failed **Deploy** run | The new version failed its smoke test and was rolled back automatically | Actions tab |
| A user or teammate reports a problem | Anything the checks don't cover | Discord, in person |

## Severity

| Level | Meaning | Examples | Respond |
| --- | --- | --- | --- |
| **SEV1** | The site is down or data is at risk | Health check failing on `/health` or the API; error rate alert; data deleted or corrupted | Straight away |
| **SEV2** | Part of the site is broken, or a safety net failed | One feature failing; backup failed or missing; automatic rollback didn't recover | Same day |
| **SEV3** | Minor or cosmetic, no user impact | Slow responses; a warning in a pipeline run | Next working session |

When unsure, pick the higher level. It can be lowered later.

## Steps

### 1. Acknowledge
Reply in `#vino-alerts` (for example "Looking at this"), so others know someone's on it. Note the time.

### 2. Check what's actually broken
```bash
python3 scripts/health_check.py https://www.vinowine.org
python3 scripts/smoke_test.py https://www.vinowine.org --timeout 60
curl -sI https://www.vinowine.org/health | grep -i x-vino-version
```
Then look at:
- **Actions tab:** did a Deploy just run? Did it roll back? Did the backup fail?
- **Cloudflare dashboard:** Workers & Pages → `vino` → Metrics and Logs, and the zone's Security → Events.
- **[Cloudflare status](https://www.cloudflarestatus.com):** if Cloudflare itself is down, there's nothing to fix on our side (accepted risk).

### 3. Stop the damage
| Cause | Action |
| --- | --- |
| A recent deploy | Check whether the automatic rollback recovered the site. If not, redeploy the last good release by hand: see [runbooks/deploy-and-rollback.md](runbooks/deploy-and-rollback.md) |
| Bad or lost data | Stop further changes if possible, note the time it happened, then restore with D1 Time Travel to just before it. Try the restore on `vino-db-test` first if there's time. See [recovery-targets.md](recovery-targets.md) |
| Backup failed | Run the backup workflow by hand (Actions → Nightly D1 backup → Run workflow). If it fails again, read the log |
| Attack or abuse traffic | Check Security → Events. Block the source with a WAF custom rule in the dashboard, then add it to `infra/security.tf` |
| Cloudflare outage | Post in the team channel; wait and monitor |

### 4. Confirm recovery
The health check and smoke test both pass, and the next scheduled health check run is green.

### 5. Close and write it up
Post a short all-clear (template below). For SEV1 and SEV2, write a blameless postmortem in `docs/postmortems/` within a few days: what happened, the timeline, the impact, what went well, what didn't, and follow-up actions. "Blameless" means it describes what the systems and processes allowed, not who made a mistake.

## Message templates

**Start:**
> 🔴 **Incident (SEV1):** www.vinowine.org is down / login is failing / … since about HH:MM UTC. Looking into it now. Next update by HH:MM.

**Update:**
> 🟠 **Update:** Cause looks like … Doing … Next update by HH:MM.

**All clear:**
> 🟢 **Resolved:** Back to normal since HH:MM UTC. Cause: … Impact: … Postmortem to follow (SEV1/SEV2 only).

## Contacts

| Who | Role |
| --- | --- |
| Noah | Infrastructure and operations; receives all alerts |
| John and the app team | Application code; first call for feature bugs |
| Professor Piccoli | Informed of any SEV1 near a milestone or demo |
