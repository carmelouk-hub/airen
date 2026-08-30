data "ovh_cloud_project_region" "milan" {
  service_name = var.cloud_project_service
  name         = var.region
}

resource "terraform_data" "provider_preflight_guard" {
  input = {
    service_name = var.cloud_project_service
    region       = var.region
  }

  lifecycle {
    precondition {
      condition     = var.provider_account_preflight_verified
      error_message = "FAIL CLOSED: live OVHcloud account/project API read-back has not been recorded."
    }
    precondition {
      condition     = var.quota_preflight_verified
      error_message = "FAIL CLOSED: live quota/flavor capability read-back has not been recorded."
    }
  }
}

resource "terraform_data" "milan_3az_guard" {
  input = {
    region_type        = data.ovh_cloud_project_region.milan.type
    availability_zones = data.ovh_cloud_project_region.milan.availability_zones
  }

  lifecycle {
    precondition {
      condition = (
        data.ovh_cloud_project_region.milan.type == "region-3-az" &&
        length(data.ovh_cloud_project_region.milan.availability_zones) == 3 &&
        alltrue([
          for zone in var.availability_zones :
          contains(data.ovh_cloud_project_region.milan.availability_zones, zone)
        ])
      )
      error_message = "FAIL CLOSED: provider read-back does not prove the exact governed Milan 3-AZ topology."
    }
  }
}

resource "ovh_cloud_project_network_private" "identity" {
  service_name = var.cloud_project_service
  name         = "airenos-identity-staging"
  regions      = [var.region]

  depends_on = [
    terraform_data.provider_preflight_guard,
    terraform_data.milan_3az_guard,
  ]
}

resource "ovh_cloud_project_network_private_subnet_v2" "identity" {
  service_name                    = var.cloud_project_service
  network_id                      = ovh_cloud_project_network_private.identity.id
  name                            = "airenos-identity-staging"
  region                          = var.region
  cidr                            = var.private_network_cidr
  dhcp                            = true
  enable_gateway_ip               = true
  use_default_public_dns_resolver = true
}

resource "ovh_cloud_project_gateway" "identity" {
  service_name = var.cloud_project_service
  name         = "airenos-identity-staging"
  model        = "s"
  region       = var.region
  network_id   = ovh_cloud_project_network_private.identity.regions_openstack_ids[var.region]
  subnet_id    = ovh_cloud_project_network_private_subnet_v2.identity.id
}

resource "ovh_cloud_project_kube" "identity" {
  service_name             = var.cloud_project_service
  name                     = "airenos-identity-staging"
  region                   = var.region
  version                  = var.kubernetes_version
  plan                     = "standard"
  private_network_id       = ovh_cloud_project_network_private.identity.regions_openstack_ids[var.region]
  nodes_subnet_id          = ovh_cloud_project_network_private_subnet_v2.identity.id
  load_balancers_subnet_id = ovh_cloud_project_network_private_subnet_v2.identity.id

  depends_on = [ovh_cloud_project_gateway.identity]
}

resource "ovh_cloud_project_kube_nodepool" "identity" {
  service_name       = var.cloud_project_service
  kube_id            = ovh_cloud_project_kube.identity.id
  name               = "identity-staging"
  flavor_name        = var.kubernetes_node_flavor
  desired_nodes      = 3
  min_nodes          = 3
  max_nodes          = 6
  autoscale          = true
  availability_zones = var.availability_zones
}

resource "terraform_data" "postgresql_topology_guard" {
  input = {
    region          = var.region
    api_plan        = "business"
    marketing_tier  = "Production"
    requested_nodes = 2
  }

  lifecycle {
    precondition {
      condition     = var.postgresql_multiaz_preflight_verified
      error_message = "FAIL CLOSED: OVHcloud PostgreSQL multi-AZ capability/placement has not been proven by live provider evidence. Do not infer it from marketing or region availability alone."
    }
  }

  depends_on = [terraform_data.milan_3az_guard]
}

resource "ovh_cloud_project_database" "keycloak" {
  service_name        = var.cloud_project_service
  description         = "airenos-keycloak-staging"
  engine              = "postgresql"
  version             = var.postgresql_version
  plan                = "business"
  flavor              = var.postgresql_flavor
  deletion_protection = true
  backup_regions      = [var.region]

  nodes {
    region     = var.region
    network_id = ovh_cloud_project_network_private.identity.regions_openstack_ids[var.region]
    subnet_id  = ovh_cloud_project_network_private_subnet_v2.identity.id
  }

  nodes {
    region     = var.region
    network_id = ovh_cloud_project_network_private.identity.regions_openstack_ids[var.region]
    subnet_id  = ovh_cloud_project_network_private_subnet_v2.identity.id
  }

  depends_on = [
    ovh_cloud_project_gateway.identity,
    terraform_data.postgresql_topology_guard,
  ]
}

resource "ovh_cloud_project_database_database" "keycloak" {
  service_name = var.cloud_project_service
  engine       = ovh_cloud_project_database.keycloak.engine
  cluster_id   = ovh_cloud_project_database.keycloak.id
  name         = "keycloak"
}
