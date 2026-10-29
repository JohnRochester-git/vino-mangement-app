terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.28.1"
    }
  }

  backend "s3" {
    bucket = "vino-terraform-state"
    key    = "vino/terraform.tfstate"
    region = "auto"
    endpoints = {
      s3 = "https://7d3e5373af825fc8b03945976e435373.r2.cloudflarestorage.com"
    }
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}