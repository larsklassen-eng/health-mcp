terraform {
  # 1.11: write-only attributes, which keep generated secrets out of the state.
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }

  # Settings per environment are in environments/<name>.s3.tfbackend:
  # terraform init -backend-config=environments/sandbox.s3.tfbackend
  backend "s3" {}
}
