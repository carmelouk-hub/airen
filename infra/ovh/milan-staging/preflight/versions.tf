terraform {
  required_version = "= 1.16.0"

  required_providers {
    ovh = {
      source  = "ovh/ovh"
      version = "= 2.19.0"
    }
  }
}

provider "ovh" {
  endpoint = "ovh-eu"
}
