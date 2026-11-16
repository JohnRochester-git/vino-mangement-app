# ADR 001: Host the whole app on Cloudflare

**Status:** Accepted
**Date:** October 2026 (Sprint 0)
**Decider:** Noah (infrastructure and operations)

## Context

The project requires the app to be cloud hosted on Cloudflare. The original operations plan ran servers on AWS, configured with Ansible and monitored with Prometheus. Keeping AWS would have meant asking for an exception to the hosting requirement, and running and patching servers ourselves.

The app is a Python (Flask) backend, a static frontend, and a SQL database, built by a small team using AI tools. Operations is one person, over about seven weeks.

## Decision

Run everything on Cloudflare's own services, defined as code:

| Layer | Service |
| --- | --- |
| Frontend | Workers static assets |
| Backend API | Cloudflare Containers (the Python backend in Docker), reached only through a Worker |
| Database | D1, reached through a bridge in the Worker |
| File storage, backups, Terraform state | R2 |
| DNS, TLS, WAF, rate limiting | Cloudflare zone settings, in Terraform |
| Infrastructure as code | Terraform for the platform; Wrangler for app deploys |
| CI/CD | GitHub Actions |
| Monitoring and alerting | Cloudflare metrics, Grafana Cloud synthetic checks, a GitHub Actions health check, Discord |

## Alternatives considered

- **Servers on AWS** (the original plan): familiar tools (EC2, Ansible, Prometheus), but needs a hosting exception, and servers to configure, patch and keep running.
- **Cloudflare in front of AWS**: meets "on Cloudflare" only partly, and keeps all of the server work.

## Consequences

**Good:**
- Meets the hosting requirement directly, with no exception.
- No servers to patch. Ansible is no longer needed.
- One provider for compute, database, storage, DNS and security, managed from one repository.
- Low cost: about $5 a month for the Workers Paid plan (required for Containers), plus a domain.

**Bad, and how we handled it:**
- **Newer, less familiar services.** Containers in particular is young, and its behaviour had to be learned by testing. For example, a Worker rollback doesn't roll back the container ([deploy runbook](../runbooks/deploy-and-rollback.md)).
- **Containers can't reach D1 directly.** The Worker runs a bridge for the backend's SQL ([d1-bridge.md](../d1-bridge.md)).
- **Container disks are wiped when they sleep.** All data lives in D1, and files go to R2.
- **Cold starts:** the first request after the container sleeps waits a few seconds. Handled for demo day by a longer sleep timer and a warm-up run ([demo-day checklist](../demo-day-checklist.md)).
- **Free-plan security limits:** one rate-limit rule, and the free managed WAF ruleset ([security.md](../security.md)).
- **Single provider:** a Cloudflare-wide outage takes the app down. Accepted for a prototype; backups are plain SQL exports that could be restored elsewhere.
- **Prometheus replaced:** monitoring uses Cloudflare's metrics and Grafana Cloud instead.
