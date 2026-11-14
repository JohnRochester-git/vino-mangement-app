# ---- WAF managed rules -----------------------------------------------------

# The Free plan's managed ruleset. Looked up by name so its ID isn't hard-coded;
# one() makes the plan fail clearly if the lookup finds none or several.
data "cloudflare_rulesets" "zone" {
  zone_id = local.zone_id
}

locals {
  free_waf_ruleset_id = one([
    for r in data.cloudflare_rulesets.zone.rulesets : r.id
    if r.kind == "managed" && r.phase == "http_request_firewall_managed" && strcontains(r.name, "Free")
  ])
}

resource "cloudflare_ruleset" "waf_managed" {
  zone_id = local.zone_id
  name    = "WAF managed rules"
  kind    = "zone"
  phase   = "http_request_firewall_managed"

  rules = [
    {
      description = "Cloudflare Free Managed Ruleset"
      expression  = "true"
      action      = "execute"
      action_parameters = {
        id = local.free_waf_ruleset_id
      }
    }
  ]
}

# ---- Rate limiting ---------------------------------------------------------

# The Free plan allows one rule, a 10-second window and a 10-second block, so
# it goes on the most exposed endpoint: login. The backend also locks an email
# out after 5 failed logins; this stops one IP hammering many emails.
resource "cloudflare_ruleset" "rate_limit" {
  zone_id = local.zone_id
  name    = "Rate limiting"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules = [
    {
      description = "Login: 5 requests per 10 seconds per IP"
      expression  = "(http.request.uri.path eq \"/api/v1/auth/login\" and http.request.method eq \"POST\")"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 10
        requests_per_period = 5
        mitigation_timeout  = 10
      }
    }
  ]
}
