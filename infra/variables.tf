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

variable "deployments" {
  description = <<-EOT
    The deployments, by name, with the branch each one is deployed from. The Terraform
    workspace picks the deployment; each has its own state and resources.
  EOT
  type        = map(string)
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

variable "instance_type" {
  description = "App server size; must be ARM (Graviton), as the images are built for ARM."
  type        = string
  default     = "t4g.micro"
}

variable "swap_mb" {
  description = "Swap file on the app server, in MB."
  type        = number
  default     = 2048
}

variable "data_volume_gb" {
  description = "Size of the data disk (database, imaging), in GB."
  type        = number
  default     = 5
}

variable "web_origin" {
  description = "The app's public URL, for sign-in redirects and Secure cookies."
  type        = string
  default     = "http://localhost:3000"
}
