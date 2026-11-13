# Deploy and rollback runbook

How the Vino app gets deployed, what happens when a deploy goes wrong, and what to do by hand if the automatic rollback isn't enough.

## How a normal deploy works

1. A pull request is merged into `main`.
2. **CI** runs: backend lint and tests, JavaScript checks, a Wrangler dry run, a Gitleaks secret scan, and a Trivy scan of the backend image.
3. If CI passes, **Deploy** runs (`.github/workflows/deploy.yml`):
   - records the live Worker version
   - runs `wrangler deploy`, which uploads the Worker and pages and builds and pushes the backend container image
   - runs `scripts/smoke_test.py` against the live site for up to 5 minutes
   - tags the commit `v1.0.<run number>` when the smoke test passes

Only commits that passed the smoke test get a tag, so the newest `v1.0.*` tag is always the last known good release.

## What a rollback does and doesn't undo

The app has two parts that roll back differently. We confirmed this in a drill on the preview Worker on Nov 13, 2026.

| Part | `wrangler rollback` | Redeploying an older release |
| --- | --- | --- |
| Worker code and pages | **Reverted within seconds** | Reverted |
| Backend container image | **Not reverted.** It keeps running the new image. | Reverted, about 1.5 minutes after the deploy command |
| Database (D1) data and schema | Not reverted | Not reverted |

In the drill, a broken backend kept failing for **12 minutes after a Worker rollback**, and was still on the broken image when we checked. Redeploying the good code brought it back about 1.5 minutes later.

**Database changes are never undone by a rollback.** That's why schema changes go in migration files, written so the previous release still works with the new schema.

## What happens automatically when the smoke test fails

1. **Roll back the Worker** to the version that was live before the deploy. This fixes page and Worker problems straight away.
2. **Redeploy the last good release** (the newest `v1.0.*` tag). This also puts the old backend container back.
3. **Smoke-test again**, for up to 10 minutes.

The Deploy run is still marked failed, and the failed commit isn't tagged. Check the run's log to see which smoke-test check failed.

## When to step in by hand

- **The "Smoke test after rollback" step failed**, or the run failed before a rollback could start. The site may still be down.
- **Something is wrong on the live site that the smoke test doesn't check**, and you need to go back to an earlier release.

### Redeploy a known good release

From a clone of the repo, with Docker Desktop running:

```bash
git fetch --tags
git tag --list 'v1.0.*' --sort=-v:refname | head   # pick a release
git switch --detach v1.0.N
cd worker
npm ci
npx wrangler deploy --env="" --message "Manual rollback to v1.0.N"
python3 ../scripts/smoke_test.py https://vino.noahvastola.workers.dev --timeout 600
git switch main
```

Expect the container to take a few minutes before the smoke test passes.

### Roll back only the Worker (pages or Worker code changed, backend didn't)

```bash
cd worker
npx wrangler deployments list --env=""      # find the version to go back to
npx wrangler rollback <version-id> --env="" --yes --message "Why"
```

Type the version ID directly. Don't paste placeholders like `<version-id>`: the shell reads `<` as a file redirect.

### Check what's actually running

```bash
cd worker
npx wrangler deployments status --env=""           # Worker version
npx wrangler containers list                       # container application ID
npx wrangler containers info <application-id>      # "image" shows the running image
curl -sI https://vino.noahvastola.workers.dev/health | grep -i x-vino-version
```

## Timings measured so far

| What | Time |
| --- | --- |
| Worker rollback taking effect | Seconds |
| New container image live after `wrangler deploy` | About 1.5 minutes (drill); allow up to 5 minutes |
| Automatic rollback after a failed deploy (run 1, Nov 12) | About 5 minutes, mostly the smoke test retrying |

## Evidence

- Deploy run 1 (Nov 12): smoke test failed, automatic rollback restored the previous version.
- Rollback drill (Nov 13): screenshots of the health watcher before and after the Worker rollback, and the `containers info` output.
- A passing pipeline run and its `v1.0.*` tag.
