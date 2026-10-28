# Your own credentials only need to be allowed to assume the deployer role;
# Terraform does everything else as that role.
provider "aws" {
  region = var.region

  assume_role {
    role_arn     = var.deployer_role_arn
    session_name = "health-mcp-terraform"
  }

  # Every resource gets the tags the sandbox account requires.
  default_tags {
    tags = {
      project = var.project
      owner   = var.owner
      pillar  = var.pillar
    }
  }
}
