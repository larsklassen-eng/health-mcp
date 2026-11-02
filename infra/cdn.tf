# The public URL: a CloudFront distribution in front of the app server, reaching it through a
# VPC origin (a private connection into the VPC). The server keeps no public IP; its security
# group lets in CloudFront's origin-facing addresses on the web port, and nothing else. HTTPS
# uses CloudFront's own certificate (https://<id>.cloudfront.net), so no domain is needed.

locals {
  web_port   = 3000
  web_origin = "https://${aws_cloudfront_distribution.app.domain_name}"

  # AWS managed policies (the same ids in every account).
  cache_disabled       = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  cache_optimized      = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  forward_all_viewer   = "216adef6-5c7f-47e4-b989-5492eafa07d3" # Managed-AllViewer
  security_headers_set = "67f7725c-6f97-4210-82d7-5512b31e9d03" # Managed-SecurityHeadersPolicy
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_vpc_security_group_ingress_rule" "server_cloudfront" {
  security_group_id = aws_security_group.server.id
  description       = "The web app, from CloudFront only"
  ip_protocol       = "tcp"
  from_port         = local.web_port
  to_port           = local.web_port
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
}

# CloudFront cannot point a VPC origin at another instance while a distribution uses it. So a
# new server gets a new VPC origin, the distribution moves to it, and only then is the old one
# deleted. Compose and deploy.sh changes do not replace the server (see server.tf).
resource "aws_cloudfront_vpc_origin" "server" {
  vpc_origin_endpoint_config {
    name                   = "${local.name_prefix}-${aws_instance.server.id}"
    arn                    = aws_instance.server.arn
    http_port              = local.web_port
    https_port             = 443
    origin_protocol_policy = "http-only" # inside the VPC; viewers always use HTTPS

    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }

  lifecycle {
    create_before_destroy = true
    replace_triggered_by  = [aws_instance.server.id]
  }
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  comment         = "health-mcp ${local.deployment}"
  price_class     = "PriceClass_100" # North America and Europe edges, the cheapest
  http_version    = "http2and3"
  is_ipv6_enabled = true

  origin {
    origin_id   = "server"
    domain_name = aws_instance.server.private_dns

    vpc_origin_config {
      vpc_origin_id = aws_cloudfront_vpc_origin.server.id
      # Chat answers stream; a model call between two events can take a while.
      origin_read_timeout = 60
    }
  }

  # Everything is per user and behind sign-in: nothing is cached, and all viewer headers
  # (Host and Origin included, for Next.js server actions), cookies and query strings go through.
  default_cache_behavior {
    target_origin_id           = "server"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_disabled
    origin_request_policy_id   = local.forward_all_viewer
    response_headers_policy_id = local.security_headers_set
  }

  # Next.js build assets have content hashes in their names, so they can be cached.
  ordered_cache_behavior {
    path_pattern               = "/_next/static/*"
    target_origin_id           = "server"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_optimized
    response_headers_policy_id = local.security_headers_set
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = "${local.name_prefix}-app" }
}
