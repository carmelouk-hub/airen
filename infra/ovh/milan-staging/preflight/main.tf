data "ovh_cloud_project" "project" {
  service_name = var.cloud_project_service
}

data "ovh_cloud_project_region" "milan" {
  service_name = var.cloud_project_service
  name         = var.region

  lifecycle {
    postcondition {
      condition     = self.status == "UP"
      error_message = "FAIL CLOSED: EU-SOUTH-MIL is not UP for the authenticated OVHcloud project."
    }
    postcondition {
      condition = (
        self.type == "region-3-az" &&
        length(self.availability_zones) == 3 &&
        toset(self.availability_zones) == toset(var.availability_zones)
      )
      error_message = "FAIL CLOSED: authenticated provider read-back does not prove the exact governed Milan 3-AZ A/B/C topology."
    }
  }
}

data "ovh_cloud_project_flavors" "worker" {
  service_name = var.cloud_project_service
  region       = var.region
  name_filter  = var.kubernetes_node_flavor

  lifecycle {
    postcondition {
      condition = length([
        for flavor in self.flavors : flavor
        if flavor.name == var.kubernetes_node_flavor &&
        flavor.region == var.region &&
        flavor.available &&
        flavor.quota >= var.minimum_worker_quota
      ]) == 1
      error_message = "FAIL CLOSED: governed Kubernetes worker flavor is unavailable or live project quota is below three workers."
    }
  }
}

data "ovh_cloud_project_database_capabilities" "database" {
  service_name = var.cloud_project_service

  lifecycle {
    postcondition {
      condition = anytrue([
        for engine in self.engines :
        lower(engine.name) == "postgresql" && contains(engine.versions, var.postgresql_version)
      ])
      error_message = "FAIL CLOSED: authenticated project database capabilities do not include the governed PostgreSQL major."
    }
    postcondition {
      condition = contains(
        [for plan in self.plans : lower(plan.name)],
        var.postgresql_api_plan,
      )
      error_message = "FAIL CLOSED: authenticated project database capabilities do not include the governed business API plan."
    }
    postcondition {
      condition = contains(
        [for flavor in self.flavors : flavor.name],
        var.postgresql_flavor,
      )
      error_message = "FAIL CLOSED: authenticated project database capabilities do not include the governed PostgreSQL flavor."
    }
  }
}

locals {
  postgresql_engines = [
    for engine in data.ovh_cloud_project_database_capabilities.database.engines : {
      name            = engine.name
      default_version = engine.default_version
      versions        = sort(tolist(engine.versions))
    }
    if lower(engine.name) == "postgresql"
  ]

  worker_flavors = [
    for flavor in data.ovh_cloud_project_flavors.worker.flavors : {
      name      = flavor.name
      region    = flavor.region
      available = flavor.available
      quota     = flavor.quota
      vcpus     = flavor.vcpus
      ram       = flavor.ram
    }
  ]

  region_services = [
    for service in data.ovh_cloud_project_region.milan.services : {
      name   = service.name
      status = service.status
    }
  ]
}
