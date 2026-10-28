# Factored AWS sandbox account (us-east-1). Identifiers only, no credentials.
region  = "us-east-1"
project = "health-mcp"
owner   = "736"
pillar  = "general"
deployments = {
  main = "main"
  rag  = "rag-option-a"
}
deployer_role_arn        = "arn:aws:iam::986608278121:role/health-mcp-deployer"
permissions_boundary_arn = "arn:aws:iam::986608278121:policy/health-mcp-DeployerPolicy"

vpc_id = "vpc-0a133342682857484"
private_subnet_ids = [
  "subnet-07790bf632edb2998",
  "subnet-04491df5b1a4fc24d",
  "subnet-0b2da32126e158bb0",
]
public_subnet_ids = [
  "subnet-0d75c9c5919023102",
  "subnet-0221bc523d0d04a99",
]
