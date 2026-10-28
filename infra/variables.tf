variable "region" {
  description = "AWS region of the account."
  type        = string
}

variable "project" {
  description = "Project name, used as a tag and as a prefix for resource names."
  type        = string
}

variable "owner" {
  description = "Owner tag required by the account."
  type        = string
}

variable "pillar" {
  description = "Pillar tag required by the account."
  type        = string
}

variable "deployer_role_arn" {
  description = "IAM role Terraform assumes to create resources."
  type        = string
}

variable "permissions_boundary_arn" {
  description = <<-EOT
    Permissions boundary every IAM role created here must use; the deployer role
    cannot create roles without it.
  EOT
  type        = string
}

variable "vpc_id" {
  description = "The project's existing VPC (managed outside this configuration)."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets of the VPC, for services and databases."
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Public subnets of the VPC, for load balancers."
  type        = list(string)
}
