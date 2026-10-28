# Infrastructure (AWS)

Terraform for the Factored AWS sandbox account (`us-east-1`). Nothing is deployed yet: this is
the foundation that later steps build on. It checks that the account's VPC and subnets are
reachable with the deployer role.

| File | What it holds |
|---|---|
| `versions.tf` | Terraform and AWS provider versions; the S3 backend |
| `providers.tf` | AWS provider: assumes the deployer role, tags every resource |
| `variables.tf` | Inputs: account settings, VPC and subnets |
| `network.tf` | Looks up the existing VPC and subnets (they are not managed here) |
| `outputs.tf` | The VPC's CIDR, and each subnet's availability zone and CIDR |
| `environments/sandbox.tfvars` | The sandbox account's values |
| `environments/sandbox.s3.tfbackend` | Where the state lives: S3, encrypted with KMS, locked by S3 |

## The sandbox account

- **Deployer role:** `health-mcp-deployer`. Your own credentials only need to be allowed to assume
  it; Terraform does the rest as that role, including reading and writing the state.
- **Permissions boundary:** every IAM role created here must set
  `permissions_boundary = local.permissions_boundary`, or the deployer role cannot create it.
- **Tags:** `project`, `owner` and `pillar` are added to every resource by the provider.
- **Network:** an existing VPC with three private subnets (services, databases) and two public
  ones (load balancers).

The files hold identifiers only (account id, ARNs, resource ids), never credentials.

## Usage

Requires Terraform 1.10 or later (`brew install hashicorp/tap/terraform`) and AWS credentials
that can assume the deployer role, for example an SSO profile:

```sh
export AWS_PROFILE=<your sandbox profile>
cd infra
terraform init -backend-config=environments/sandbox.s3.tfbackend
terraform plan -var-file=environments/sandbox.tfvars
terraform apply -var-file=environments/sandbox.tfvars   # creates nothing yet, prints the outputs
```

CI checks formatting and validates the configuration without AWS access (`terraform init
-backend=false`). It never plans or applies.
