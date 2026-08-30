terraform {
  required_version = "= 1.16.0"

  required_providers {
    ovh = {
      source  = "ovh/ovh"
      version = "= 2.19.0"
    }
  }

  # The live gate MUST initialize this backend with an encrypted, versioned,
  # access-controlled S3-compatible OVHcloud Object Storage backend. No bucket,
  # endpoint or credential is committed here. CI uses `terraform init -backend=false`.
  backend "s3" {}
}

provider "ovh" {
  endpoint = "ovh-eu"
}
