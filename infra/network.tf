# The VPC and subnets come with the account. Looking them up checks that the IDs
# exist and are reachable with the deployer role before anything is built on them.
data "aws_vpc" "main" {
  id = var.vpc_id

  lifecycle {
    # Refuses the default workspace, so nothing lands outside a deployment.
    precondition {
      condition     = contains(keys(var.deployments), terraform.workspace)
      error_message = <<-EOT
        Workspace "${terraform.workspace}" is not a deployment. Select one of:
        ${join(", ", keys(var.deployments))} (terraform workspace select <name>).
      EOT
    }
  }
}

data "aws_subnet" "private" {
  for_each = toset(var.private_subnet_ids)
  id       = each.value

  lifecycle {
    postcondition {
      condition     = self.vpc_id == var.vpc_id
      error_message = "Private subnet ${each.value} is not in ${var.vpc_id}."
    }
  }
}

data "aws_subnet" "public" {
  for_each = toset(var.public_subnet_ids)
  id       = each.value

  lifecycle {
    postcondition {
      condition     = self.vpc_id == var.vpc_id
      error_message = "Public subnet ${each.value} is not in ${var.vpc_id}."
    }
  }
}

locals {
  # The workspace is the deployment, e.g. "main" or "rag".
  deployment = terraform.workspace
  # Prefix for resource names, so the deployments never share a resource,
  # e.g. "health-mcp-rag-api".
  name_prefix = "${var.project}-${local.deployment}"

  # For IAM roles created later: aws_iam_role.permissions_boundary = local.permissions_boundary
  permissions_boundary = var.permissions_boundary_arn
}
