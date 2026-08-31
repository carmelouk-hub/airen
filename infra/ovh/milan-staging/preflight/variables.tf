variable "cloud_project_service" {
  description = "Existing OVHcloud Public Cloud project service name. It is an identifier, not a credential."
  type        = string

  validation {
    condition     = length(trimspace(var.cloud_project_service)) > 0
    error_message = "cloud_project_service must identify an existing OVHcloud Public Cloud project."
  }
}

variable "region" {
  description = "Governed OVHcloud Milan 3-AZ region identifier."
  type        = string
  default     = "EU-SOUTH-MIL"

  validation {
    condition     = var.region == "EU-SOUTH-MIL"
    error_message = "The live preflight is pinned to EU-SOUTH-MIL."
  }
}

variable "availability_zones" {
  description = "Exact governed Milan availability-zone set."
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
    error_message = "The live preflight must preserve the exact Milan A/B/C availability-zone set."
  }
}

variable "kubernetes_node_flavor" {
  description = "Governed worker flavor whose live availability and quota are read back from OVHcloud."
  type        = string
  default     = "b3-8"
}

variable "minimum_worker_quota" {
  description = "Minimum live quota required for the governed three-worker staging topology."
  type        = number
  default     = 3

  validation {
    condition     = var.minimum_worker_quota == 3
    error_message = "The current staging preflight requires quota for exactly the three-worker minimum baseline."
  }
}

variable "postgresql_version" {
  description = "Governed PostgreSQL major whose availability is read back from project database capabilities."
  type        = string
  default     = "17"
}

variable "postgresql_flavor" {
  description = "Governed PostgreSQL flavor whose project capability is read back."
  type        = string
  default     = "b3-8"
}

variable "postgresql_api_plan" {
  description = "Provider/API plan name corresponding to the intended current Production-class two-node target."
  type        = string
  default     = "business"

  validation {
    condition     = var.postgresql_api_plan == "business"
    error_message = "The current provider contract is pinned to the API plan name business."
  }
}
