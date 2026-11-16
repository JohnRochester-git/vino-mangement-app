# Demo-day checklist

Steps to make sure www.vinowine.org works during the demo. Times are relative to the demo start.

## 2 days before

- [ ] **Announce the deploy freeze** in the team channel: no merges to `main` from the day before the demo until it's over, unless it fixes a demo-blocking bug and the team agrees.
  > Heads-up: deploy freeze from [day] until after the demo. Please don't merge to `main` in that window. If something's blocking the demo, message Noah first.
- [ ] **Check the last week's runs are green:** CI, Deploy, nightly backup and Health check on the Actions tab, and both Grafana checks.
- [ ] **Prepare the demo account** on the live site (sign up, add the wines you'll show). Don't rely on test data: the preview uses a separate database.
- [ ] **Agree who presents what**, and that teammates know the backup plan below.

## The day before

- [ ] **Lengthen the container sleep timer**, so a quiet moment during the demo doesn't send the backend to sleep and make the next click wait for a cold start. In `worker/src/index.js`, change `sleepAfter = "10m"` to `sleepAfter = "3h"`. Merge it through a pull request (the last change before the freeze) and check the Deploy run passes.
- [ ] **Confirm a fresh backup exists:** last night's "Nightly D1 backup" run is green.
- [ ] **Test the full demo** on www.vinowine.org from a different device or network.

## 30 minutes before

- [ ] **Warm up the site:**
  ```bash
  python3 scripts/smoke_test.py https://www.vinowine.org --stable-seconds 60
  ```
  Then open the login page, log in with the demo account, and click through the screens you'll show. This starts both containers.
- [ ] **Check the dashboards:** both Grafana checks green; Cloudflare: Workers & Pages → `vino` → Metrics shows no errors.
- [ ] **Open the tabs you'll need:** the site, the Grafana `vino-health` dashboard, the Actions tab, and `#vino-alerts`.

## During the demo

- If something breaks, follow [incident-response.md](incident-response.md). The quickest manual fix is the runbook's "Redeploy a known good release" with `--containers-rollout=immediate` ([deploy runbook](runbooks/deploy-and-rollback.md)).
- **Backup plan:** screenshots or a short screen recording of the main flows, prepared in advance, in case the site can't be restored in time.
- To show the operations side: a Grafana dashboard, a recent Deploy run with its smoke test and tag, and the Discord alert history.

## After

- [ ] **Put the sleep timer back** to `"10m"` (it costs container time while awake), through a pull request.
- [ ] **Lift the deploy freeze** in the team channel.
- [ ] Note anything that went wrong; if it was a real incident, write a postmortem in `docs/postmortems/`.
