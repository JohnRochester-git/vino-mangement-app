# Security

Every security control in the Vino app, where it's set, and its known limits. Settings marked **Terraform** live in `infra/`; **Wrangler** in `worker/wrangler.jsonc`; **CI** in `.github/workflows/`.

## Network and HTTPS (vinowine.org)

| Control | Setting | Where |
| --- | --- | --- |
| HTTPS between Cloudflare and the origin | SSL mode Full (strict) | Terraform `zone.tf` |
| HTTP redirected to HTTPS | Always Use HTTPS on | Terraform `zone.tf` |
| Old TLS refused | Minimum TLS 1.2 (TLS 1.3 also on) | Terraform `zone.tf` |
| HSTS | `max-age=86400` (1 day), no subdomains, no preload; `nosniff` on | Terraform `zone.tf` |
| One public address | `www.vinowine.org` only. `vinowine.org` redirects to it, and the `workers.dev` address is turned off | Terraform `zone.tf`, Wrangler |

HSTS starts at one day because browsers cache it and it can't be quickly undone. Raise `max_age` once the site is settled.

Zone settings can't be deleted by Terraform: removing one from the code leaves its last value in place.

`workers.dev` is off because the WAF, rate limit and HTTPS settings only apply to the domain; a second public address would bypass them.

## Web application firewall and rate limiting

| Control | Setting | Where | Verified |
| --- | --- | --- | --- |
| WAF managed rules | Cloudflare Free Managed Ruleset, on all traffic | Terraform `security.tf` | Yes: a Log4Shell-style probe was blocked with a 403 (Nov 13) |
| Rate limit on login | `POST /api/v1/auth/login`: 5 requests per 10 seconds per IP, then blocked for 10 seconds | Terraform `security.tf` | **No (see Known limits)** |
| Login lockout (backend) | 5 failed logins for one email within 15 minutes locks that email for 5 minutes | `backend/vino/auth.py` | Yes: returned 429 during testing |

## Application

- **Passwords** are stored only as salted hashes, using Werkzeug's `generate_password_hash`. With the pinned Werkzeug 3.1.9 that's scrypt (`scrypt:32768:8:1`), checked Nov 16.
- **Sessions** are random tokens in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie. The database stores only a SHA-256 hash of each token. Sessions last 14 days.
- **Sign in with Google** uses OpenID Connect's authorization code flow with PKCE. Each sign-in gets a one-time `state` (stored hashed, valid 10 minutes, usable once) against forged or replayed callbacks, and a `nonce` that must come back inside the ID token. The backend swaps the code for the ID token directly with Google over HTTPS, then checks the issuer, audience (our client ID), expiry, nonce and that Google has verified the email. Only verified emails can link a Google sign-in to an existing password account. Accounts created through Google have no usable password. The result is the same session as a password login. Details: [api.md](api.md#sign-in-with-google).
- **The D1 bridge isn't public.** The backend reaches the database through the Worker's outbound handler for `d1.internal`, which only the container can call. The public Worker routes only `/api/*` and `/health` to the container.
- **Only `frontend/` is published as the website**, so code, config and `.git` are never served by the Worker.
- **The container runs as a non-root user** (`appuser`).

## Secrets and access

No secrets are in the repository. Gitleaks scans the full history on every pull request.

| Credential | Used by | Permissions | Stored in |
| --- | --- | --- | --- |
| Deploy token | `deploy.yml` | Account: Workers Scripts Edit, Containers Edit, D1 Read, Account Settings Read. Zone `vinowine.org`: Workers Routes Edit, DNS Edit, Zone Read | GitHub secret `CF_DEPLOY_TOKEN` |
| Terraform token | `terraform.yml`, local Terraform | Account: Workers R2 Storage Edit, D1 Edit. Zone `vinowine.org`: Zone Read, Zone Settings Edit, DNS Edit, Zone WAF Edit, Single Redirect Edit | GitHub secret `CF_TERRAFORM_TOKEN` |
| Backup token | `backup.yml` | D1 Edit, Workers R2 Storage Edit | GitHub secret `CLOUDFLARE_API_TOKEN` |
| Analytics token | `health.yml` | Zone `vinowine.org`: Analytics Read | GitHub secret `CF_ANALYTICS_TOKEN` |
| R2 state keys | Terraform state backend | Object Read & Write on `vino-terraform-state` only | GitHub secrets `TF_STATE_ACCESS_KEY_ID`, `TF_STATE_SECRET_ACCESS_KEY` |
| Discord webhook | `health.yml`, `backup.yml` | Can post to `#vino-alerts` only | GitHub secret `DISCORD_WEBHOOK_URL` |
| Google OAuth client secret | The backend, for Google sign-in | Swaps sign-in codes for ID tokens for this app's Google client only | Wrangler secret `GOOGLE_CLIENT_SECRET`, set separately for live and preview |
| Account ID | All Cloudflare workflows | Not a credential | GitHub secret `CLOUDFLARE_ACCOUNT_ID` |

Each token does one job, so a leak is contained: the backup token can't deploy, the deploy token can't change zone settings, and the analytics token can only read traffic numbers.

## Pipeline

- **Branch protection on `main`:** changes arrive by pull request, and the four CI checks (`backend`, `worker`, `secrets`, `image`) must pass.
- **CI scans:** Gitleaks for secrets; Trivy fails the build on HIGH or CRITICAL issues with a fix available. The image applies Debian security updates at build time.
- **Pinned versions:** Python packages, npm packages, the base image, the Terraform provider and Terraform itself. Third-party GitHub Actions are pinned by commit SHA.
- **Least-privilege workflows:** every workflow is read-only by default. Only Deploy can write, and only to push release tags.
- **Terraform applies only by hand,** after reading the plan.
- **Logs:** the backup job strips the one-hour download link Wrangler prints, because run logs can be public. The Terraform plan summary hides the account ID.

## Data protection

- **Backups:** a nightly export of `vino-db` to the private `vino-backups` R2 bucket. Exports include password hashes, so that bucket must stay private.
- **Point-in-time restore:** D1 Time Travel, 30 days on the Workers Paid plan.
- **Test data separate:** the preview Worker uses only `vino-db-test`.

## Monitoring

- **Uptime monitoring from outside GitHub** (Grafana Cloud Synthetic Monitoring, free tier), from 2 US locations:
  - `vino-health`: `/health` must return 200 and `OK`, every 2 minutes.
  - `vino-api`: `/api/v1/auth/me` must return 401 `not_authenticated`, every 5 minutes.
  - Failures alert Discord `#vino-alerts` through a Grafana contact point. This is the main outage alert: it's independent of GitHub, which ran the scheduled health check only every few hours during the Nov 15 game day.
  - Each check has a dashboard with uptime, reachability per location and response time. About 60,000 check runs a month, within the free 100,000.
- **Scheduled health check** (`health.yml`, GitHub Actions): the site, the API, the last successful backup (older than 30 hours alerts), and the share of 5xx responses over the last 15 minutes (over 5% with at least 20 requests alerts). Problems post to Discord, and the failed run also triggers GitHub's failure email. Scheduled every 15 minutes, but GitHub runs it only every few hours, so it's a backstop for the backup and error-rate checks rather than the outage alert.
- **Backup failures** alert Discord straight away.
- See [incident-response.md](incident-response.md) for what to do when an alert fires.

## Known limits

- **The login rate limit isn't verified.** The rule exists and is active, but bursts of up to 46 logins in 10 seconds from one address (Nov 13, around 21:40–21:52 UTC) got no 429. The backend's per-email lockout is the protection in effect. To investigate.
- **The Free plan allows one rate-limit rule**, so only login is covered.
- **The container can reach the internet.** The containers library allows it by default. Setting `enableInternet = false` on the `Backend` class would limit it to the D1 bridge; Open Food Facts, which the live site uses for barcode lookups, would then need allowing by name.
- **The preview Worker is public** on its own `workers.dev` address. It holds only test data. A Zero Trust login is a deferred nice-to-have.
- **No security headers beyond HSTS and `nosniff`** (for example, no Content-Security-Policy). Deferred nice-to-have.
- **Terraform state has no versioning or lock.** One person runs Terraform, and the workflow never runs two jobs at once.
- **GitHub Pages publishes the repository** at `johnrochester-git.github.io/vino-mangement-app`. Nothing secret is in the repo, but it's a second, non-working copy of the site. Decision pending with the repo owner.
- **GitHub scheduled jobs start late.** Every scheduled backup so far started 7–10 hours after 07:00 UTC, and the 15-minute health check ran only every few hours. Grafana's checks cover outage alerting; backups still run once a day, within the 30-hour RPO.
- **Wrangler on the maintainer's laptop** is logged in with broad OAuth permissions. Day-to-day deploys go through the pipeline's narrower token.
