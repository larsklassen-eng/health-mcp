terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
    }
  }

  # Settings per environment are in environments/<name>.s3.tfbackend:
  # terraform init -backend-config=environments/sandbox.s3.tfbackend
  backend "s3" {}
}
