resource "cloudflare_d1_database" "live" {
  account_id = var.account_id
  name       = "vino-db"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_d1_database" "test" {
  account_id = var.account_id
  name       = "vino-db-test"
}