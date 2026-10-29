resource "cloudflare_r2_bucket" "bottle_images" {
  account_id = var.account_id
  name       = "vino-bottle-images"
}

resource "cloudflare_r2_bucket" "backups" {
  account_id = var.account_id
  name       = "vino-backups"
}