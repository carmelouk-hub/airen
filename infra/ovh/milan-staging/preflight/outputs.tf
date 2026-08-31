output "account" {
  description = "Sanitized authenticated Public Cloud project read-back."
  value = {
    service_name = data.ovh_cloud_project.project.service_name
    project_name = data.ovh_cloud_project.project.project_name
    project_id   = data.ovh_cloud_project.project.project_id
    status       = data.ovh_cloud_project.project.status
    access       = data.ovh_cloud_project.project.access
    manual_quota = data.ovh_cloud_project.project.manual_quota
  }
}

output "milan_region" {
  description = "Sanitized authenticated Milan region/AZ/service read-back."
  value = {
    name               = var.region
    status             = data.ovh_cloud_project_region.milan.status
    type               = data.ovh_cloud_project_region.milan.type
    country_code       = data.ovh_cloud_project_region.milan.country_code
    availability_zones = sort(tolist(data.ovh_cloud_project_region.milan.availability_zones))
    services           = local.region_services
  }
}

output "worker_flavor" {
  description = "Sanitized live worker flavor availability and quota evidence."
  value       = local.worker_flavors
}

output "postgresql_capability" {
  description = "Sanitized project-level PostgreSQL capability evidence. This is not physical multi-AZ placement proof."
  value = {
    engines = local.postgresql_engines
    plans   = sort([for plan in data.ovh_cloud_project_database_capabilities.database.plans : plan.name])
    flavors = sort([for flavor in data.ovh_cloud_project_database_capabilities.database.flavors : flavor.name])
  }
}

output "postgresql_multiaz_topology_proven" {
  description = "Always false in the capability preflight: project capability metadata cannot prove physical database AZ placement."
  value       = false
}

output "live_apply_authorized" {
  description = "Always false in this read-only gate. A separate governed topology proof and apply authorization are mandatory."
  value       = false
}

output "evidence_classification" {
  value = "PROVIDER_AUTHENTICATED_READBACK_ONLY / NOT_APPLY_AUTHORIZATION"
}
