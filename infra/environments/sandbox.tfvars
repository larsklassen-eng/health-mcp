# Factored AWS sandbox account (us-east-1). Identifiers only, no credentials.
region  = "us-east-1"
project = "health-mcp"
owner   = "736"
pillar  = "general"
# One deployment, `rag`, deployed from main. Its name dates from when the RAG code
# lived on the rag-option-a branch; renaming it would recreate every resource.
deployments = {
  rag = "main"
}
permissions_boundary_arn = "arn:aws:iam::986608278121:policy/health-mcp-DeployerPolicy"

vpc_id = "vpc-0a133342682857484"
private_subnet_ids = [
  "subnet-05723bcdd684bc371", # health-mcp-us-east-1a-prv
  "subnet-003062975c6c70017", # health-mcp-us-east-1b-prv
  "subnet-00d9b579fbfcb2f74", # health-mcp-us-east-1d-prv
]
public_subnet_ids = [
  "subnet-0d75c9c5919023102",
  "subnet-0221bc523d0d04a99",
]
