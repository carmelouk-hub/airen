output "governed_region" {
  value = {
    api_region         = var.region
    provider_type      = data.ovh_cloud_project_region.milan.type
    availability_zones = data.ovh_cloud_project_region.milan.availability_zones
  }
}

output "private_network_id" {
  value = ovh_cloud_project_network_private.identity.id
}

output "kubernetes_cluster_id" {
  value = ovh_cloud_project_kube.identity.id
}

output "keycloak_database_cluster_id" {
  value = ovh_cloud_project_database.keycloak.id
}

output "keycloak_database_name" {
  value = ovh_cloud_project_database_database.keycloak.name
}

# Deliberately no kubeconfig, database URI, password, bootstrap credential,
# provider token or other secret-bearing output is exported by this module.
