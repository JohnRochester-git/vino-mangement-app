# Networking

How a request reaches the Vino app: the domain, DNS, HTTPS, and why the backend can only be reached through the Worker.

## The domain

| | |
| --- | --- |
| Domain | `vinowine.org`, registered with Cloudflare Registrar |
| Account | Noah's Cloudflare account (moved from a teammate's account on Nov 13, 2026) |
| Name servers | Cloudflare (`meera.ns.cloudflare.com`, `mustafa.ns.cloudflare.com`) |
| Public address | `https://www.vinowine.org` |

## DNS records

| Name | Type | Points to | Managed by |
| --- | --- | --- | --- |
| `www.vinowine.org` | Worker custom domain | The `vino` Worker | Wrangler (`routes` in `worker/wrangler.jsonc`) |
| `vinowine.org` | AAAA `100::`, proxied | Nothing: a placeholder so Cloudflare answers, then redirects | Terraform (`infra/zone.tf`) |

`100::` is a "discard" address. No traffic is ever sent there, because the redirect rule answers first.

## HTTPS and redirects

All in Terraform (`infra/zone.tf`):

- **Full (strict) SSL**, **Always Use HTTPS**, **minimum TLS 1.2**, and **HSTS** (1 day for now).
- `http://…` → `https://…` (301)
- `vinowine.org/anything` → `https://www.vinowine.org/anything`, keeping the query string (301)

The HTTPS certificate for `www.vinowine.org` is issued and renewed by Cloudflare automatically.

## The path of a request

```
Browser
  │  https://www.vinowine.org/...
  ▼
Cloudflare edge (zone vinowine.org)
  │  HTTPS, TLS 1.2+, WAF managed rules, login rate limit, redirects
  ▼
Worker "vino"
  ├─ a file in frontend/ exists?      → served directly (pages, CSS, JS)
  ├─ /api/* or /health                → one of 2 backend containers (picked at random)
  └─ anything else                    → 404
                                          │
                                          ▼
                              Container: gunicorn + Flask, port 8000
                                          │  SQL as HTTP to http://d1.internal
                                          ▼
                              Worker's outbound handler (the D1 bridge)
                                          │
                                          ▼
                                     D1 database vino-db
```

Static files are served by Cloudflare before the Worker's code runs, so they don't carry the `X-Vino-Version` header. Everything the Worker handles does.

## Why the backend is only reachable through the Worker

- **Containers have no public address.** Cloudflare Containers are started and reached only through their Durable Object, which only the `vino` Worker can call. There's no URL or IP that reaches gunicorn directly.
- **The Worker decides what reaches the backend:** only `/api/*` and `/health`.
- **The D1 bridge isn't a public route.** `d1.internal` isn't a real hostname. Requests from the container to it are intercepted inside Cloudflare (`Backend.outboundByHost` in `worker/src/index.js`) and never leave Cloudflare's network. Nothing on the internet can send it SQL.
- **One public address.** `workers.dev` is turned off for the live Worker, so every request goes through the zone's WAF and HTTPS settings.

## Other addresses

| Address | What | Data |
| --- | --- | --- |
| `vino-preview.noahvastola.workers.dev` | The preview Worker, for drills and risky changes | Test database `vino-db-test` only |
| `johnrochester-git.github.io/vino-mangement-app` | GitHub Pages copy of the repository (not part of the deployment; decision pending) | None |

## Outbound connections

| From | To | Why |
| --- | --- | --- |
| Backend container | `d1.internal` (intercepted by the Worker) | Database |
| Backend container | The internet | Allowed by the containers library's default. Not used while the barcode lookup provider is off. See [security.md](security.md) |
| Grafana Cloud probes (2 US locations) | `www.vinowine.org` | Uptime checks |
| GitHub Actions | Cloudflare API, `www.vinowine.org` | Deploys, backups, Terraform, health checks |
