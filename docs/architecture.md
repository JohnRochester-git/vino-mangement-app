# Architecture

The Vino app runs entirely on Cloudflare, deployed and checked automatically from GitHub. Why Cloudflare: [ADR 001](adr/001-cloudflare-native.md). How requests flow: [networking.md](networking.md).

## Three tiers

The app follows the classic three-tier layout. Sign-in uses Google as an external identity provider, alongside email and password. The environment the tiers run in is shown on the side.

Printable, high-resolution versions of both diagrams: [images/architecture-tiers.png](images/architecture-tiers.png) and [images/architecture-operations.png](images/architecture-operations.png). These are rendered from the diagrams below; re-render them if a diagram changes.

```mermaid
flowchart TB
    subgraph pres["1 · Presentation tier"]
        browser(["Visitor's browser"])
        pages["Web pages: HTML, CSS, JS<br/>login, welcome, cellar dashboard"]
    end

    subgraph app["2 · Application tier"]
        gateway["API gateway: Worker 'vino'<br/>routes /api/* to the backend"]
        api["Backend API: Flask + gunicorn (2 containers)<br/>accounts, sessions, Google sign-in,<br/>cellar, journal, value, insights"]
    end

    subgraph data["3 · Data tier"]
        d1[("D1 vino-db<br/>users, sessions, wines, inventory,<br/>consumption, value_history, wishlist")]
        r2[("R2 vino-bottle-images<br/>photos, keyed by wine.wineImageKey")]
    end

    google["Google Identity<br/>OAuth 2.0 / OpenID Connect<br/>external sign-in"]

    subgraph env["Environment"]
        direction TB
        edge["Cloudflare edge<br/>DNS, HTTPS, WAF, rate limit"]
        hosting["Cloudflare Workers + Containers<br/>hosting, gradual rollout"]
        cicd["GitHub Actions<br/>CI, deploy, Terraform, backups"]
        monitor["Grafana Cloud + health check<br/>alerts to Discord"]
        edge ~~~ hosting ~~~ cicd ~~~ monitor
    end

    browser -->|loads| pages
    pages -->|"API calls with session cookie"| gateway
    gateway -->|"/api/*"| api
    api -->|"SQL, through the Worker's D1 bridge"| d1
    api -.->|"photos (planned)"| r2
    api <-->|"Google sign-in:<br/>code → ID token"| google
```

- **Presentation tier:** static pages, served by Cloudflare. They hold no data of their own; everything comes from the API.
- **Application tier:** the Worker is the only way in to the backend (the containers have no public address) and the only way out to the database. The backend owns all business rules, accounts and sessions.
- **Data tier:** D1 holds all app data, including historical values (`value_history`). R2 is where bottle photos go, keyed by `wine.wineImageKey`; photo upload isn't built yet.
- **Google sign-in:** the browser goes to Google, Google sends it back to the backend with a one-time code, and the backend swaps the code for an ID token directly with Google. The backend then creates its own session, the same as for a password login. Details: [api.md](api.md#sign-in-with-google).

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
        live["Worker 'vino' + containers<br/>the live site"]
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
