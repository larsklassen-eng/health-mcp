# Credentials come from the environment. Only GitHub Actions can use the
# deployer role (see .github/workflows/deploy.yml), so Terraform runs there.
provider "aws" {
  region = var.region

  # Every resource gets the tags the sandbox account requires, and its deployment.
  default_tags {
    tags = {
      project    = var.project
      owner      = var.owner
      pillar     = var.pillar
      deployment = terraform.workspace
    }
  }
}
