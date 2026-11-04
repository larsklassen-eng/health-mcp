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

# --- RAG monitoring (Phoenix, see server/monitoring.sh.tftpl)
#
# PHOENIX_API_KEY is what the api and the MCP server send their traces with,
# and Phoenix's admin secret. Phoenix's own secrets are under /phoenix/, which
# app.env does not read (deploy.sh writes them to phoenix.env instead). Sign in
# to Phoenix as admin@localhost with the initial password, read with:
#   aws ssm get-parameter --with-decryption --query Parameter.Value --output text \
#     --name /health-mcp/rag/phoenix/PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD

ephemeral "random_password" "phoenix_api_key" {
  length  = 64
  special = false
}

ephemeral "random_password" "phoenix_secret" {
  length  = 64
  special = false
}

# Meets Phoenix's strong password policy; `-` and `_` keep it easy to paste.
ephemeral "random_password" "phoenix_admin_password" {
  length           = 24
  min_upper        = 1
  min_lower        = 1
  min_numeric      = 1
  min_special      = 1
  override_special = "-_"
}

resource "aws_ssm_parameter" "phoenix_api_key" {
  name             = "${local.parameter_prefix}/PHOENIX_API_KEY"
  description      = "Phoenix (RAG monitoring) API key for traces, and its admin secret (generated)"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.phoenix_api_key.result
  value_wo_version = local.secrets_version
}

resource "aws_ssm_parameter" "phoenix_secret" {
  name             = "${local.parameter_prefix}/phoenix/PHOENIX_SECRET"
  description      = "Phoenix (RAG monitoring) session signing key (generated)"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.phoenix_secret.result
  value_wo_version = local.secrets_version
}

resource "aws_ssm_parameter" "phoenix_admin_password" {
  name             = "${local.parameter_prefix}/phoenix/PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD"
  description      = "Phoenix's admin@localhost password until changed in its UI (generated)"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.phoenix_admin_password.result
  value_wo_version = local.secrets_version
}
