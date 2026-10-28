# The VPC and subnets come with the account. Looking them up checks that the IDs
# exist and are reachable with the deployer role before anything is built on them.
data "aws_vpc" "main" {
  id = var.vpc_id
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
  # For IAM roles created later: aws_iam_role.permissions_boundary = local.permissions_boundary
  permissions_boundary = var.permissions_boundary_arn
}
