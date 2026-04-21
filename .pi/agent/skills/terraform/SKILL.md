---
name: terraform
description: "Design and modify Terraform projects safely, with strong state, module, provider, and naming discipline. Use when creating or changing Terraform environments, modules, backends, providers, or plans, especially in AWS and multi-account setups."
---

# Terraform Skill

Use this skill when working on Terraform in any repository, especially when:

- designing new infrastructure
- modifying existing stacks
- adding or refactoring modules
- changing providers, backends, accounts, or regions
- reviewing plans for safety
- working in AWS or multi-account environments

## Core Goal

Make Terraform changes that are:

- safe to apply
- easy to reason about
- explicit about blast radius
- stable for long-lived state
- modular without being over-abstracted

In Terraform, a tiny naming or address change can cause replacement of real infrastructure. Prefer **predictability over cleverness**.

## First: Learn the Repository Shape

Before editing, inspect how the repo is organized. Common patterns include:

- root stacks per environment/account/region
- shared modules
- separate backend bootstrap stacks
- platform or organization-management stacks
- service-specific stacks

Identify:

- where deployable root modules live
- where reusable modules live
- how environments/accounts are separated
- how providers are configured
- how remote state is managed

Do not impose a new layout unless the user asks for a structural refactor.

### Example repository tree

A common and reasonable Terraform layout looks like this:

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

This is only an example, not a requirement. The important part is that:

- deployable root stacks are clearly separated
- shared modules are centralized
- environments such as `dev`, `qa`, `stg`, and `prd` are easy to locate
- backend/bootstrap infrastructure is isolated from workload stacks
- account or region boundaries are obvious from the directory structure and provider wiring

## Required Workflow

### 1) Identify the true scope

Determine whether the change belongs in:

- one root stack only
- a shared module used by many stacks
- backend/bootstrap infrastructure
- an organization/platform account stack
- CI/CD or deployment wiring

Do **not** edit a shared module until you understand who consumes it.

### 2) Trace the call chain

Read inputs from the root module down to the actual resources.

Typically this means tracing:

- root stack variables and locals
- module calls
- provider aliases
- child module inputs/outputs
- the concrete resource definitions

Do not guess where a value is used. Trace it.

### 3) Protect state-sensitive identifiers

Assume these are high risk:

- resource names and prefixes
- module addresses
- backend bucket/table/key settings
- provider alias/account wiring
- regions
- VPC CIDRs and subnet shapes
- database identifiers
- bucket names
- DNS names and certificate domains
- `for_each` keys and `count` indexes

A rename is often a migration, not a cosmetic cleanup.

### 4) Validate in the smallest useful scope

Prefer targeted validation:

```bash
terraform fmt -recursive
cd <root-stack>
terraform init
terraform validate
terraform plan
```

If a backend must be bootstrapped first, do that in its own stack before planning the dependent stack.

## Design Principles

### 1) Root stacks should be thin

Root stacks should mostly:

- select the target account/region/environment
- set environment-specific values
- configure providers
- wire shared modules together
- document exceptions or migrations

Avoid duplicating lots of low-level resources across many root stacks unless they are truly one-off.

### 2) Modules should have one clear responsibility

Prefer focused modules over giant abstraction layers.

Good module responsibilities are things like:

- networking
- compute
- database
- observability
- identity/access
- DNS
- storage
- application services

If orchestration across several domains is needed, use a higher-level composition module rather than stuffing everything into a leaf module.

### 3) Provider configuration belongs near the top

In most repos, root or composition layers should own:

- credentials
- profiles
- assume-role config
- regions
- provider aliases

Child modules should receive providers explicitly when needed.

Leaf modules should not hardcode account assumptions, profiles, or regions.

### 4) Inputs must be typed and documented

When adding variables:

- always set `type`
- add a useful `description`
- provide defaults only when truly safe
- use `null` for optional behavior when appropriate
- use validation rules when bad input would be costly

### 5) Outputs should be intentional

Only output values that consumers actually need.

Avoid exposing an entire internal graph from reusable modules unless there is a clear reason.

Prefer precise outputs such as IDs, ARNs, names, endpoints, and security-group IDs over broad dumps of module internals.

### 6) Use locals for meaning, not mystery

Use `locals` to clarify intent:

- separate external naming from internal naming
- define derived tags and prefixes
- centralize shared conventions
- reduce repeated expressions

Locals should make the code easier to understand, not hide important behavior.

### 7) Match the repository’s file conventions

Common Terraform file patterns include:

- `main.tf`, `variables.tf`, `outputs.tf`
- split files by concern such as `network.tf`, `dns.tf`, `iam.tf`
- `versions.tf` and `providers.tf`

Follow the local convention of the module or stack you are editing. Avoid unrelated file churn.

## State and Backend Rules

### 1) Treat state as critical infrastructure

Remote state must be:

- versioned where supported
- encrypted
- access-controlled
- isolated by stack/account/environment as appropriate
- protected from accidental deletion

For AWS, this usually means:

- S3 backend with encryption enabled
- state locking via lockfile or DynamoDB, depending on Terraform version and team conventions
- tightly scoped IAM access to state objects

### 2) Prefer separate root stacks over overloaded workspaces

For serious multi-environment or multi-account infrastructure, prefer separate root stacks and separate state files rather than relying entirely on Terraform workspaces.

Workspaces can be useful, but they are usually not a substitute for clear stack boundaries.

### 3) Backend changes are migrations

Changing any of these is a migration event:

- backend bucket
- backend key/path
- backend region
- locking mechanism
- state layout
- root module pathing that changes resource addresses

Consider whether you need:

- `terraform init -migrate-state`
- `terraform state mv`
- `terraform import`
- staged cutovers
- migration documentation

### 4) Protect irreplaceable resources appropriately

For critical resources, consider lifecycle protections such as:

- `prevent_destroy`
- deletion protection on managed services
- backup retention
- versioning

Use protection intentionally, especially for shared or production data stores.

## Multi-Account Guidance

When working across multiple AWS accounts, optimize for clear ownership and isolation.

### Recommended mental model

Common account patterns include:

- management / organization account
- shared services account
- security or audit account
- networking account
- workload accounts per environment or tenant

Not every repo will use all of these, but you should infer the intended boundaries before making changes.

### Rules for multi-account Terraform

- keep provider aliases explicit
- make account boundaries obvious in root stacks
- avoid hidden cross-account side effects
- document which account owns each resource
- keep state separated by account and stack
- be careful with centralized services like DNS, certificates, KMS, and IAM

### Cross-account access

Prefer explicit trust relationships and assumed roles over broad credentials.

For AWS, root stacks commonly use:

- named profiles for local operator workflows
- `assume_role` for automation or delegated access
- aliased providers for shared or centralized accounts

If a stack touches multiple accounts, make that explicit in provider blocks and module wiring.

## AWS-Specific Guidance

### 1) Be explicit about region and account

Always know:

- which account you are targeting
- which region a resource belongs to
- whether a global service still has regional constraints

Be especially careful with:

- Route53
- ACM certificates for CloudFront
- IAM
- KMS keys
- ECR replication
- VPC peering or Transit Gateway
- cross-region disaster recovery patterns

### 2) Use tagging consistently

Prefer a shared tag set driven from locals or variables.

Typical tags include:

- environment
- application or service
- owner/team
- cost center
- managed-by = terraform
- data classification, if used by the org

Do not hardcode tags inconsistently across modules.

### 3) Secure by default

For AWS resources, default toward:

- encryption at rest
- private networking where possible
- least-privilege IAM
- restricted security groups
- blocked public access for storage unless intentionally public
- logging and retention where operationally important

### 4) Avoid hardcoding secrets

Do not commit secrets into Terraform code or variable files.

Prefer:

- Secrets Manager
- SSM Parameter Store
- externally supplied CI/CD secrets
- generated passwords when appropriate

### 5) Respect immutable fields

Many AWS resources force replacement when certain arguments change. Be cautious when editing:

- DB identifiers and cluster settings
- bucket names
- subnet CIDRs
- load balancer scheme or subnet associations
- certificate domains
- `for_each` keys that map to named resources

## Naming Guidance

Use naming that is:

- stable
- predictable
- short enough for provider limits
- meaningful across accounts and regions

If external naming and internal naming need to differ, model that explicitly in variables or locals rather than relying on accidental string reuse.

Do not rename identifiers casually in existing infrastructure.

## Safety Rules for Changes

### High-risk changes

Treat these as dangerous and call them out clearly:

- changing provider account or region wiring
- changing backend configuration
- changing naming prefixes or environment identifiers
- changing `for_each` keys or converting `count` to `for_each`
- changing network topology or CIDRs
- changing database/storage identifiers
- changing DNS, certificate, or load balancer relationships
- refactoring module paths or resource addresses

### Lower-risk changes

Usually lower risk, but still verify with a plan:

- adding alarms or dashboards
- adjusting autoscaling thresholds
- tuning CPU/memory sizes
- adding tags or descriptions
- introducing optional outputs
- documentation-only updates

### Always inspect for replacement

When reviewing a plan, look for:

- `must be replaced`
- destroy/create pairs
- unexpected resource address changes
- changes to immutable attributes
- broad blast radius from a shared module edit

Do not assume a simple variable change is safe.

## Documentation Rules

Document exceptional decisions near the affected stack or module.

Add or update docs when:

- naming intentionally diverges from a default convention
- a backend or state layout changes
- multi-account wiring is non-obvious
- a migration requires careful apply order
- a module has unusual assumptions
- a change avoids replacement through a specific convention

If a future maintainer will ask “why is this done this way?”, write it down.

## Preferred Change Strategy

When implementing a Terraform change, prefer this order:

1. understand the current topology
2. identify the correct layer to change
3. make the smallest safe code change
4. run `terraform fmt`
5. run `terraform validate` and `terraform plan` in the relevant root stack
6. inspect for destroy/replace risk
7. update docs if the change introduces a convention, exception, or migration

## Checklist Before Finishing

Before considering the work done, verify:

- the change is in the correct layer
- all new variables are typed and described
- provider aliases and account wiring are correct
- state and backend implications were considered
- naming changes will not trigger unintended replacement
- `terraform fmt` has been run
- the relevant stack can `init`, `validate`, and `plan`
- risky changes were called out clearly to the user
- docs were updated if any convention or migration changed

## Default Attitude

Be conservative.

In Terraform, preserving state continuity and resource identity is usually more important than making the code look cleaner. Prefer explicitness, migration notes, and predictable plans over elegant-but-risky refactors.
