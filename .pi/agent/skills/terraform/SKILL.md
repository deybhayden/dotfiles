---
name: terraform
description: "Design and modify Terraform projects safely, with strong state, module, provider, and naming discipline. Use when creating or changing Terraform environments, modules, backends, providers, or plans, especially in AWS and multi-account setups."
---

# Terraform Skill

Use this skill for Terraform work, especially when changing stacks, modules, providers, backends, or account/region wiring.

## Core Goal

Make Terraform changes that are:

- safe to apply
- easy to review
- explicit about blast radius
- stable for long-lived state

Prefer **predictability over cleverness**. Small address or naming changes can replace real infrastructure.

## First: Learn the Repository Shape

Before editing, identify:

- deployable root stacks
- reusable modules
- environment/account/region boundaries
- provider wiring
- remote state/backends

Do not impose a new layout unless the user asks for a refactor.

### Example repository tree

```text
terraform/
├── modules/
│   ├── networking/
│   ├── database/
│   ├── compute/
│   ├── iam/
│   └── observability/
├── environments/
│   ├── dev/
│   │   ├── backend.tf
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── terraform.tfvars
│   ├── qa/
│   │   ├── backend.tf
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── terraform.tfvars
│   ├── stg/
│   │   ├── backend.tf
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── terraform.tfvars
│   └── prd/
│       ├── backend.tf
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── terraform.tfvars
├── bootstrap/
│   ├── state-backend/
│   └── organization/
└── README.md
```

This is an example, not a requirement. Keep root stacks, shared modules, and bootstrap/state infrastructure clearly separated.

## Required Workflow

### 1) Identify the true scope

Decide whether the change belongs in:

- one root stack
- a shared module
- backend/bootstrap infrastructure
- organization/platform wiring
- CI/CD or deployment wiring

Do **not** edit a shared module until you know who consumes it.

### 2) Trace the call chain

Trace values from the root stack to the concrete resources:

- variables and locals
- module calls
- provider aliases
- child module inputs/outputs
- resource definitions

Do not guess where a value is used.

### 3) Protect state-sensitive identifiers

Treat these as high risk:

- resource names and prefixes
- module addresses
- backend bucket/table/key settings
- provider alias/account wiring
- regions
- VPC CIDRs and subnet layouts
- database identifiers
- bucket names
- DNS names and certificate domains
- `for_each` keys and `count` indexes

A rename is often a migration, not cleanup.

### 4) Validate in the smallest useful scope

Prefer targeted validation:

```bash
terraform fmt -recursive
cd <root-stack>
terraform init
terraform validate
terraform plan
```

If backend/state infrastructure must exist first, bootstrap it separately.

## Design Rules

### Root stacks

Keep root stacks thin. They should mainly:

- choose account/region/environment
- configure providers
- set environment-specific values
- wire modules together
- document exceptions or migrations

### Modules

Give modules one clear responsibility. Prefer focused modules over large abstractions.

### Providers

Keep provider configuration near the top. Root or composition layers should own credentials, roles, regions, and aliases. Pass providers explicitly to child modules when needed.

### Variables and outputs

For new variables:

- set `type`
- add a useful `description`
- add defaults only when safe
- use validation for expensive mistakes

Expose only outputs that consumers actually need.

### Locals and files

Use `locals` to clarify naming, tags, and shared expressions, not to hide behavior.

Match local file conventions such as:

- `main.tf`, `variables.tf`, `outputs.tf`
- split-by-concern files like `iam.tf` or `network.tf`
- `providers.tf`, `versions.tf`, `backend.tf`

Avoid unrelated file churn.

## State and Backend Rules

Treat state as critical infrastructure.

Remote state should be:

- encrypted
- access-controlled
- isolated by stack/account/environment as needed
- protected from accidental deletion
- versioned where supported

For AWS, follow the repo's existing locking pattern. Newer Terraform/OpenTofu setups may use S3 lock files with `use_lockfile = true`; older repos may still use DynamoDB locking.

If you use S3 lock files, make sure backend IAM can access both the state object and the lock file object, typically `<key>.tflock`.

Prefer a dedicated `backend.tf` in each root stack.

```hcl
terraform {
  backend "s3" {
    key          = "app/env/terraform.tfstate"
    bucket       = "terraform-states-<account_id>-<region>"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
```

Keep auth details such as local `profile` settings in partial backend config or other local-only wiring unless the repo already commits them. Follow existing partial-backend or `-backend-config` patterns unless the user asks for a refactor.

### Backend changes are migrations

Treat changes to any of these as migrations:

- backend bucket
- backend key/path
- backend region
- locking mechanism
- state layout
- root module pathing that changes resource addresses

You may need `terraform init -migrate-state`, `terraform state mv`, `terraform import`, or staged cutovers.

### Prefer clear stack boundaries

For serious multi-environment or multi-account setups, prefer separate root stacks and separate state files over heavily relying on workspaces.

### Protect critical resources

Use protection intentionally where appropriate, such as:

- `prevent_destroy`
- deletion protection
- backups and retention
- versioning

## Multi-Account and AWS Guidance

Optimize for clear ownership and isolation.

### Multi-account rules

- keep provider aliases explicit
- make account boundaries obvious
- avoid hidden cross-account side effects
- separate state by account and stack
- document which account owns shared resources

Prefer explicit trust relationships and assumed roles over broad credentials.

### AWS rules

Always know the target account and region. Be extra careful with global-or-regional edge cases such as Route53, ACM for CloudFront, IAM, KMS, and cross-region patterns.

Default toward:

- encryption at rest
- private networking where possible
- least-privilege IAM
- restricted security groups
- blocked public access unless intentional
- logging where operationally important

Do not commit secrets into Terraform or tfvars files. Prefer Secrets Manager, SSM Parameter Store, CI/CD secrets, or generated secrets.

Use tagging consistently, usually via locals or variables.

## Safety Rules for Changes

Call out high-risk changes clearly, especially:

- provider account or region rewiring
- backend changes
- naming or environment identifier changes
- `for_each` key changes or `count` ↔ `for_each` conversions
- network topology or CIDR changes
- database/storage identifier changes
- DNS, certificate, or load balancer relationship changes
- module path or resource address refactors

When reviewing a plan, explicitly look for:

- `must be replaced`
- destroy/create pairs
- unexpected address changes
- immutable attribute changes
- broad blast radius from shared module edits

## Documentation Rules

Document exceptions near the affected stack or module, especially when:

- naming intentionally differs from convention
- backend/state layout changes
- multi-account wiring is non-obvious
- apply or migration order matters
- a module has unusual assumptions

If a future maintainer will ask “why is it like this?”, write it down.

## Preferred Change Strategy

1. understand the current topology
2. identify the correct layer
3. make the smallest safe change
4. run `terraform fmt`
5. run `terraform validate` and `terraform plan` in the relevant root stack
6. inspect for destroy/replace risk
7. update docs if you introduced a convention, exception, or migration

## Checklist Before Finishing

- change is in the correct layer
- new variables are typed and described
- provider aliases and account wiring are correct
- state/backend implications were considered
- naming changes will not trigger unintended replacement
- `terraform fmt` has been run
- the relevant stack can `init`, `validate`, and `plan`
- risky changes were called out clearly
- docs were updated if conventions or migrations changed

## Default Attitude

Be conservative. Preserving state continuity and resource identity matters more than cosmetic cleanup.
