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

output "image_repositories" {
  description = "ECR repository URL of each app."
  value       = { for service, repo in aws_ecr_repository.app : service => repo.repository_url }
}

output "parameters" {
  description = "SSM parameters holding the deployment's secrets."
  value = [
    aws_ssm_parameter.mcp_auth_token.name,
    aws_ssm_parameter.session_secret.name,
    aws_ssm_parameter.openrouter_api_key.name,
  ]
}

output "server_instance_id" {
  description = "The app server, for SSM: aws ssm start-session --target <id>."
  value       = aws_instance.server.id
}
