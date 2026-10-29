# Secrets of the deployment, in SSM Parameter Store (SecureString), under
# /health-mcp/<deployment>/. The server reads them at start-up.
#
# MCP_AUTH_TOKEN and SESSION_SECRET are generated here. They are ephemeral and
# written with write-only arguments, so they never appear in the Terraform
# state or plan. Raise `secrets_version` to generate new ones (a new
# SESSION_SECRET signs everyone out).
#
# OPENROUTER_API_KEY is created with a placeholder; set the real key yourself:
#   aws ssm put-parameter --overwrite --type SecureString \
#     --name /health-mcp/rag/OPENROUTER_API_KEY --value <key>

locals {
  parameter_prefix = "/${var.project}/${local.deployment}"
  secrets_version  = 1
}

ephemeral "random_password" "mcp_auth_token" {
  length  = 64
  special = false
}

ephemeral "random_password" "session_secret" {
  length  = 64
  special = false
}

resource "aws_ssm_parameter" "mcp_auth_token" {
  name             = "${local.parameter_prefix}/MCP_AUTH_TOKEN"
  description      = "Shared secret between the api and the MCP server (generated)"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.mcp_auth_token.result
  value_wo_version = local.secrets_version
}

resource "aws_ssm_parameter" "session_secret" {
  name             = "${local.parameter_prefix}/SESSION_SECRET"
  description      = "Key that signs sign-in sessions (generated)"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.session_secret.result
  value_wo_version = local.secrets_version
}

resource "aws_ssm_parameter" "openrouter_api_key" {
  name        = "${local.parameter_prefix}/OPENROUTER_API_KEY"
  description = "OpenRouter API key for chat; set by hand (see secrets.tf)"
  type        = "SecureString"
  value       = "not-set"

  lifecycle {
    # The real key is set outside Terraform and must not be overwritten.
    ignore_changes = [value]
  }
}
