# The app server: one small ARM instance in a private subnet, running the
# three containers with Docker Compose (see server/). No inbound access yet;
# admins reach it with SSM Session Manager, never SSH. Its data lives on a
# separate disk, so replacing the instance keeps the database.

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_caller_identity" "current" {}

locals {
  account_id       = data.aws_caller_identity.current.account_id
  server_subnet_id = var.private_subnet_ids[0]
  server_az        = data.aws_subnet.private[local.server_subnet_id].availability_zone
  registry         = "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com"
  ssm_arn_prefix   = "arn:aws:ssm:${var.region}:${local.account_id}"
  parameter_arn    = "${local.ssm_arn_prefix}:parameter${local.parameter_prefix}"
  data_dir         = "/srv/health-mcp/data"
}

# --- Permissions of the server: SSM (sessions and commands), pulling its
# images, reading its secrets. Nothing else.

resource "aws_iam_role" "server" {
  name                 = "${local.name_prefix}-server"
  permissions_boundary = local.permissions_boundary
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "server_ssm" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "server" {
  name = "app"
  role = aws_iam_role.server.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "PullImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability",
        ]
        Resource = [for repo in aws_ecr_repository.app : repo.arn]
      },
      {
        Sid      = "ReadSecrets"
        Effect   = "Allow"
        Action   = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
        Resource = [local.parameter_arn, "${local.parameter_arn}/*"]
      },
    ]
  })
}

resource "aws_iam_instance_profile" "server" {
  name = "${local.name_prefix}-server"
  role = aws_iam_role.server.name
}

# --- Network: no inbound rules (CloudFront is let in by a later step);
# outbound through the VPC's NAT for images, secrets and OpenRouter.

resource "aws_security_group" "server" {
  name        = "${local.name_prefix}-server"
  description = "health-mcp ${local.deployment} app server"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_egress_rule" "server_all" {
  security_group_id = aws_security_group.server.id
  description       = "Images, secrets, OpenRouter, OS updates"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# --- The data disk (SQLite database, imaging slices)

resource "aws_ebs_volume" "data" {
  availability_zone = local.server_az
  size              = var.data_volume_gb
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "${local.name_prefix}-data" }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.server.id
  # Stop the instance before detaching, so the database is closed cleanly.
  stop_instance_before_detaching = true
}

# --- The instance

resource "aws_instance" "server" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.instance_type
  subnet_id              = local.server_subnet_id
  vpc_security_group_ids = [aws_security_group.server.id]
  iam_instance_profile   = aws_iam_instance_profile.server.name

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/server/user-data.sh.tftpl", {
    data_dir        = local.data_dir
    data_volume_id  = aws_ebs_volume.data.id
    swap_mb         = var.swap_mb
    compose_version = "v5.6.1"
    compose_file = templatefile("${path.module}/server/compose.yml.tftpl", {
      registry    = local.registry
      name_prefix = local.name_prefix
      data_dir    = local.data_dir
      web_origin  = var.web_origin
    })
    deploy_script = templatefile("${path.module}/server/deploy.sh.tftpl", {
      region           = var.region
      registry         = local.registry
      parameter_prefix = local.parameter_prefix
    })
  })

  tags = { Name = "${local.name_prefix}-server" }

  lifecycle {
    # A newer Amazon Linux image should not replace a running server.
    ignore_changes = [ami]
  }
}
