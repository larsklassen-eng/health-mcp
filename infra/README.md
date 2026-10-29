# Infrastructure (AWS)

Terraform for the Factored AWS sandbox account (`us-east-1`), with two independent deployments:
one per branch. Nothing is deployed yet: this is the foundation that later steps build on. It
checks that the account's VPC and subnets are reachable with the deployer role.

## Deployments

| Deployment (workspace) | Branch | State in S3 | Resource names |
|---|---|---|---|
| `main` | `main` | `health-mcp/main/terraform.tfstate` | `health-mcp-main-*` |
| `rag` | `rag-option-a` | `health-mcp/rag/terraform.tfstate` | `health-mcp-rag-*` |

The Terraform workspace picks the deployment. Each one has its own state, its own resources
(named with `local.name_prefix` and tagged with `deployment`) and, once the app is deployed, its
own URL, database, secrets and login, so access to one never gives access to the other. Nothing
is shared between them except the account's VPC. The default workspace is refused, and the
deployments are listed in `environments/sandbox.tfvars`.

Apply a deployment from its own branch, so the `rag` deployment runs the RAG code.

| File | What it holds |
|---|---|
| `versions.tf` | Terraform and AWS provider versions; the S3 backend |
| `providers.tf` | AWS provider: credentials from the environment, tags every resource |
| `variables.tf` | Inputs: account settings, VPC and subnets |
| `network.tf` | Looks up the existing VPC and subnets (they are not managed here); the deployment's name prefix |
| `outputs.tf` | The deployment, the VPC's CIDR, and each subnet's availability zone and CIDR |
| `environments/sandbox.tfvars` | The sandbox account's values and the deployments |
| `environments/sandbox.s3.tfbackend` | Where the state lives: S3 (one file per deployment), encrypted with KMS, locked by S3 |

## The sandbox account

- **Deployer role:** `health-mcp-deployer`. Only GitHub Actions in `factoredai/health-mcp` can
  use it (its trust policy allows GitHub's OIDC tokens for that repo, any branch), so Terraform
  runs there as that role, including reading and writing the state. Personal SSO roles cannot
  assume it.
- **Permissions boundary:** every IAM role created here must set
  `permissions_boundary = local.permissions_boundary`, or the deployer role cannot create it.
- **Tags:** `project`, `owner`, `pillar` and `deployment` are added to every resource by the
  provider.
- **Network:** an existing VPC with three private subnets (services, databases) and two public
  ones (load balancers).

The files hold identifiers only (account id, ARNs, resource ids), never credentials.

## Usage

Terraform runs in GitHub Actions (`.github/workflows/infra.yml`), on every push to `main` or
`rag-option-a` that changes `infra/` or the workflow, or by hand from the Actions tab
("Infra" → "Run workflow", on the branch to plan). For the branch's deployment it:

1. logs in as the deployer role with GitHub's OIDC token (no stored AWS keys);
2. runs `terraform init` with `environments/sandbox.s3.tfbackend`;
3. selects the deployment's workspace (`main` or `rag`), creating it on the first run;
4. runs `terraform plan` and adds the end of the plan to the run's summary.

It only plans; nothing is applied yet. It runs only in `factoredai/health-mcp`, so pushes to
personal copies skip it.

Locally, without AWS access, you can check the configuration (as the CI workflow does on every
push to `main`):

```sh
cd infra
terraform fmt -check -recursive
terraform init -backend=false && terraform validate
```
