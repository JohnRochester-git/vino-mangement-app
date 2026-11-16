# Architecture

The Vino app runs entirely on Cloudflare, deployed and checked automatically from GitHub. Why Cloudflare: [ADR 001](adr/001-cloudflare-native.md). How requests flow: [networking.md](networking.md).

## Runtime: what serves a visitor

```mermaid
flowchart LR
    user([Visitor's browser])

    subgraph cf[Cloudflare]
        edge["Zone vinowine.org<br/>HTTPS, TLS 1.2+, HSTS<br/>WAF managed rules<br/>login rate limit<br/>vinowine.org → www redirect"]
        worker["Worker 'vino'<br/>routes /api/* and /health<br/>D1 bridge (d1.internal)"]
        assets["Static assets<br/>frontend/: pages, CSS, JS"]
        subgraph containers[Cloudflare Containers]
            c1["Backend container 1<br/>Flask + gunicorn"]
            c2["Backend container 2<br/>Flask + gunicorn"]
        end
        d1[("D1 vino-db<br/>live database")]
        r2img[("R2 vino-bottle-images")]
    end

    user -->|https://www.vinowine.org| edge --> worker
    worker -->|pages| assets
    worker -->|/api/*, /health| c1
    worker -->|/api/*, /health| c2
    c1 -.->|SQL via d1.internal| worker
    c2 -.->|SQL via d1.internal| worker
    worker -->|D1 binding| d1
```

The containers have no public address: the Worker is the only way in, and the only way out to the database.

## Operations: how it's built, deployed, backed up and watched

```mermaid
flowchart TB
    dev([Pull request]) --> ci

    subgraph gh[GitHub]
        ci["CI<br/>ruff + pytest, JS checks,<br/>Wrangler dry run,<br/>Gitleaks, Docker build + Trivy"]
        deploy["Deploy<br/>wrangler deploy (gradual rollout)<br/>smoke test, 3 min stable<br/>roll back + redeploy last good tag<br/>tag v1.0.N"]
        tf["Terraform<br/>plan on PRs<br/>apply by hand"]
        backup["Nightly backup<br/>D1 export → R2"]
        health["Health check<br/>site, API, backup age,<br/>5xx error rate"]
    end

    subgraph cf[Cloudflare]
        live["Worker 'vino' + containers<br/>www.vinowine.org"]
        preview["Worker 'vino-preview'<br/>+ D1 vino-db-test"]
        d1[("D1 vino-db")]
        r2b[("R2 vino-backups")]
        r2s[("R2 vino-terraform-state")]
        zone["Zone settings,<br/>WAF, redirects"]
    end

    grafana["Grafana Cloud<br/>synthetic checks<br/>every 2–5 min"]
    discord([Discord #vino-alerts])

    ci -->|merged to main| deploy --> live
    tf --> zone
    tf --> d1
    tf --- r2s
    backup --> d1
    backup --> r2b
    health --> live
    grafana --> live
    health -->|on failure| discord
    backup -->|on failure| discord
    grafana -->|alerts| discord
```

The preview Worker is deployed by hand, for drills and risky changes.

## Components

| Component | What | Defined in |
| --- | --- | --- |
| Frontend | Static HTML, CSS and JS | `frontend/` |
| Worker `vino` | Serves the frontend, routes to the backend, bridges SQL to D1, adds `X-Vino-Version` | `worker/src/index.js`, `worker/wrangler.jsonc` |
| Backend | Flask API in Docker, run by gunicorn, 2 instances (max 3) | `backend/`, `backend/Dockerfile` |
| D1 `vino-db`, `vino-db-test` | Live and test databases, with 30-day point-in-time restore | `infra/d1.tf`, migrations in `backend/migrations/` |
| R2 buckets | Bottle images, nightly backups, Terraform state | `infra/r2.tf` (state bucket made by hand) |
| Zone `vinowine.org` | DNS, HTTPS, WAF, rate limit, redirect | `infra/zone.tf`, `infra/security.tf` |
| Pipelines | CI, deploy, Terraform, backup, health check | `.github/workflows/` |
| Monitoring | Grafana Cloud synthetic checks, GitHub health check, Cloudflare metrics | Grafana Cloud, `scripts/health_check.py` |
| Alerts | Discord `#vino-alerts`, plus GitHub failure emails | GitHub secrets, Grafana contact point |
