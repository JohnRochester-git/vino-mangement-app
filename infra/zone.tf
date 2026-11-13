# The vinowine.org zone (added in the Cloudflare dashboard, then moved from the
# dev's account on Nov 13). Terraform looks it up instead of managing the zone
# itself, so a mistake here can never delete it.
data "cloudflare_zone" "vinowine" {
  filter = {
    name = "vinowine.org"
  }
}

locals {
  zone_id = data.cloudflare_zone.vinowine.id
}

# ---- HTTPS settings --------------------------------------------------------

# Full (strict): Cloudflare only talks to the origin over HTTPS with a valid
# certificate.
resource "cloudflare_zone_setting" "ssl" {
  zone_id    = local.zone_id
  setting_id = "ssl"
  value      = "strict"
}

# Redirect every http:// request to https://.
resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = local.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = local.zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

# HSTS tells browsers to use HTTPS only. It's hard to undo once browsers have
# cached it, so max_age starts at 1 day with no subdomains or preload.
# Raise it once the site is settled.
resource "cloudflare_zone_setting" "hsts" {
  zone_id    = local.zone_id
  setting_id = "security_header"
  value = {
    strict_transport_security = {
      enabled            = true
      max_age            = 86400
      include_subdomains = false
      preload            = false
      nosniff            = true
    }
  }
}

# ---- vinowine.org -> www.vinowine.org ---------------------------------------

# www.vinowine.org's record is created and managed by the Worker's custom
# domain (worker/wrangler.jsonc), not here.

# The bare domain needs a proxied record for Cloudflare to answer it at all.
# 100:: is a "discard" address: nothing is ever sent there, because the
# redirect rule below answers first.
resource "cloudflare_dns_record" "apex" {
  zone_id = local.zone_id
  name    = "vinowine.org"
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1 # automatic
  comment = "Placeholder for the redirect to www (infra/zone.tf)"
}

resource "cloudflare_ruleset" "redirects" {
  zone_id = local.zone_id
  name    = "Redirects"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [
    {
      description = "vinowine.org to www.vinowine.org"
      expression  = "(http.host eq \"vinowine.org\")"
      action      = "redirect"
      action_parameters = {
        from_value = {
          status_code = 301
          target_url = {
            expression = "concat(\"https://www.vinowine.org\", http.request.uri.path)"
          }
          preserve_query_string = true
        }
      }
    }
  ]
}
