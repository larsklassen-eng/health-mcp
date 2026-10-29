# Container images, one repository per app, per deployment
# (e.g. health-mcp-rag-api). The deploy workflow pushes each build tagged with
# its commit and as `latest`.

locals {
  services = toset(["api", "mcp-server", "web"])
}

resource "aws_ecr_repository" "app" {
  for_each = local.services

  name = "${local.name_prefix}-${each.key}"
  # `latest` moves with every deploy; commit tags never change.
  image_tag_mutability = "MUTABLE"
  # Sandbox: `terraform destroy` also removes the images.
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each = aws_ecr_repository.app

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
