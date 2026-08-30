variable "cloud_project_service" {
  description = "Existing OVHcloud Public Cloud project service name. Supply through a non-committed tfvars file or environment; it is not a credential."
  type        = string

  validation {
    condition     = length(trimspace(var.cloud_project_service)) > 0
    error_message = "cloud_project_service must identify an existing OVHcloud Public Cloud project."
  }
}

variable "region" {
  description = "Canonical OVHcloud 3-AZ Milan region identifier used by MKS/DBaaS APIs."
  type        = string
  default     = "EU-SOUTH-MIL"

  validation {
    condition     = var.region == "EU-SOUTH-MIL"
    error_message = "This governed staging contract is pinned to EU-SOUTH-MIL."
  }
}

variable "availability_zones" {
  description = "Exact Milan 3-AZ worker placement set."
  type        = list(string)
  default = [
    "eu-south-mil-a",
    "eu-south-mil-b",
    "eu-south-mil-c",
  ]

  validation {
    condition = toset(var.availability_zones) == toset([
      "eu-south-mil-a",
      "eu-south-mil-b",
      "eu-south-mil-c",
    ]) && length(var.availability_zones) == 3
    error_message = "Milan staging must preserve the exact three-AZ placement set."
  }
}

variable "private_network_cidr" {
  description = "Dedicated AIRenOS Identity staging private network CIDR."
  type        = string
  default     = "10.42.0.0/20"
}

variable "kubernetes_version" {
  description = "Pinned overlap between current OVHcloud MKS support and Keycloak 26.7.2 supported Kubernetes API range."
  type        = string
  default     = "1.34"

  validation {
    condition     = var.kubernetes_version == "1.34"
    error_message = "This staging checkpoint is pinned to Kubernetes 1.34; upgrading requires a governed compatibility gate."
  }
}

variable "kubernetes_node_flavor" {
  description = "OVHcloud worker flavor; capability/quota must be confirmed during live provider preflight."
  type        = string
  default     = "b3-8"
}

variable "postgresql_version" {
  description = "Keycloak PostgreSQL major version supported by Keycloak 26.7.2 and OVHcloud DBaaS."
  type        = string
  default     = "17"

  validation {
    condition     = contains(["16", "17", "18"], var.postgresql_version)
    error_message = "Use a currently supported PostgreSQL major from the governed allowlist."
  }
}

variable "postgresql_flavor" {
  description = "OVHcloud DBaaS flavor; live capabilities endpoint remains authoritative."
  type        = string
  default     = "b3-8"
}

variable "provider_account_preflight_verified" {
  description = "Must become true only after a live OVHcloud account/project API read-back. Never set true from static tests."
  type        = bool
  default     = false
}

variable "quota_preflight_verified" {
  description = "Must become true only after live quota/capability read-back for the selected region/flavors."
  type        = bool
  default     = false
}

variable "postgresql_multiaz_preflight_verified" {
  description = "Must become true only after live provider evidence proves the selected PostgreSQL Production/Business topology meets the governed multi-AZ requirement."
  type        = bool
  default     = false
}
