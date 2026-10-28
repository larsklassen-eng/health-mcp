output "deployment" {
  description = "The deployment (workspace), its branch and its resource name prefix."
  value = {
    name        = local.deployment
    branch      = var.deployments[local.deployment]
    name_prefix = local.name_prefix
  }
}

output "vpc_cidr" {
  description = "CIDR block of the VPC."
  value       = data.aws_vpc.main.cidr_block
}

output "private_subnets" {
  description = "Availability zone and CIDR of each private subnet."
  value = {
    for id, subnet in data.aws_subnet.private :
    id => "${subnet.availability_zone} ${subnet.cidr_block}"
  }
}

output "public_subnets" {
  description = "Availability zone and CIDR of each public subnet."
  value = {
    for id, subnet in data.aws_subnet.public :
    id => "${subnet.availability_zone} ${subnet.cidr_block}"
  }
}
