#!/usr/bin/env bash
# Provision the BeThere DEV API on AWS App Runner + RDS Postgres (us-east-1).
#
# This is the reproducible record of how the *dev* backend was stood up, mirroring the
# prod stack in infra/aws-deploy.sh. The dev stack is an ISOLATED copy so the `dev`
# branch (which runs ahead of `main` - new migrations + API procedures) can be exercised
# at a stable URL without touching prod. Like aws-deploy.sh, this is NOT re-run blindly -
# most steps fail if the resource already exists.
#
# Crucially, dev REUSES prod's shared infra and only adds two billable resources:
#   reused : default VPC + subnets, ECR repo bethere-api (separate :dev TAG), IAM pull
#            role bethere-apprunner-ecr-role, VPC connector bethere-vpc-conn, RDS SG
#            bethere-rds-sg (already allows the App Runner egress SG on 5432).
#   new    : RDS instance bethere-db-dev, App Runner service bethere-api-dev.
#
# A separate ECR *tag* (:dev vs prod's :latest) is what keeps the two backends
# independent: each App Runner service auto-deploys only on pushes to its own tag.
set -euo pipefail

export AWS_REGION=us-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/bethere-api"

# Shared resources created by aws-deploy.sh (looked up, not re-created).
RDS_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=bethere-rds-sg \
  --query 'SecurityGroups[0].GroupId' --output text)
ROLE_ARN=$(aws iam get-role --role-name bethere-apprunner-ecr-role --query 'Role.Arn' --output text)
CONN_ARN=$(aws apprunner list-vpc-connectors \
  --query "VpcConnectorList[?VpcConnectorName=='bethere-vpc-conn']|[0].VpcConnectorArn" --output text)

# --- DEV RDS Postgres (private, same class as prod, own credentials) ---
# bethere-db-dev reuses the prod subnet group and RDS SG. The SG already permits ingress
# from the App Runner egress SG on 5432, so attaching it needs no new rule.
DB_PASS=$(openssl rand -hex 24)   # store in infra/.deploy-state-dev.local; goes into DATABASE_URL
aws rds create-db-instance \
  --db-instance-identifier bethere-db-dev \
  --engine postgres --engine-version 16.14 \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 --storage-type gp3 \
  --master-username bethere --master-user-password "$DB_PASS" \
  --db-name bethere \
  --vpc-security-group-ids "$RDS_SG" \
  --db-subnet-group-name bethere-subnets \
  --no-publicly-accessible --backup-retention-period 1 --no-multi-az \
  --no-enable-performance-insights
aws rds wait db-instance-available --db-instance-identifier bethere-db-dev
RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier bethere-db-dev \
  --query 'DBInstances[0].Endpoint.Address' --output text)

# --- Bootstrap image: App Runner can't create a service from a tag that does not exist ---
# Build the API from the current dev checkout and push it as :dev. The deploy-api-dev.yml
# workflow keeps :dev current on every push to dev thereafter.
aws ecr get-login-password | docker login --username AWS --password-stdin "${ECR_URI%%/*}"
docker build --platform linux/amd64 --provenance=false -f apps/api/Dockerfile -t "${ECR_URI}:dev" .
docker push "${ECR_URI}:dev"

# --- DEV App Runner service ---
# Env mirrors prod (CLERK_JWT_KEY / CLERK_SECRET_KEY / DEV_AUTH_BYPASS / SEED_ON_BOOT)
# but with the dev DATABASE_URL and a FRESH ADMIN_RESET_TOKEN (never reuse prod's secret).
# Copy the Clerk values from the prod service:
#   aws apprunner describe-service --service-arn <prod-arn> \
#     --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables'
DATABASE_URL="postgres://bethere:${DB_PASS}@${RDS_ENDPOINT}:5432/bethere"
ADMIN_RESET_TOKEN=$(openssl rand -hex 24)
cat > /tmp/apprunner-dev.json <<JSON
{
  "ServiceName": "bethere-api-dev",
  "SourceConfiguration": {
    "AuthenticationConfiguration": { "AccessRoleArn": "${ROLE_ARN}" },
    "AutoDeploymentsEnabled": true,
    "ImageRepository": {
      "ImageIdentifier": "${ECR_URI}:dev",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "DATABASE_URL": "${DATABASE_URL}",
          "SEED_ON_BOOT": "if-empty",
          "DEV_AUTH_BYPASS": "1",
          "ADMIN_RESET_TOKEN": "${ADMIN_RESET_TOKEN}",
          "CLERK_JWT_KEY": "<copy from prod>",
          "CLERK_SECRET_KEY": "<copy from prod>"
        }
      }
    }
  },
  "InstanceConfiguration": { "Cpu": "0.5 vCPU", "Memory": "1 GB" },
  "HealthCheckConfiguration": {
    "Protocol": "HTTP", "Path": "/trpc/health",
    "Interval": 10, "Timeout": 5, "HealthyThreshold": 1, "UnhealthyThreshold": 5
  },
  "NetworkConfiguration": {
    "EgressConfiguration": { "EgressType": "VPC", "VpcConnectorArn": "${CONN_ARN}" }
  }
}
JSON
aws apprunner create-service --cli-input-json file:///tmp/apprunner-dev.json \
  --query 'Service.{Arn:ServiceArn,Url:ServiceUrl}' --output json

# --- Broaden the CI user so the dev workflow's rollback-alert can read the dev service ---
# bethere-ci's apprunner permission was scoped to service/bethere-api/* which does not match
# service/bethere-api-dev/*. Widen to bethere-api*/* (ECR push already covers the shared repo).
aws iam put-user-policy --user-name bethere-ci --policy-name bethere-ci-ecr-push \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ecr:GetAuthorizationToken\",\"Resource\":\"*\"},{\"Effect\":\"Allow\",\"Action\":[\"ecr:BatchCheckLayerAvailability\",\"ecr:InitiateLayerUpload\",\"ecr:UploadLayerPart\",\"ecr:CompleteLayerUpload\",\"ecr:PutImage\",\"ecr:BatchGetImage\"],\"Resource\":\"arn:aws:ecr:${AWS_REGION}:${ACCOUNT}:repository/bethere-api\"},{\"Effect\":\"Allow\",\"Action\":[\"apprunner:DescribeService\",\"apprunner:ListOperations\"],\"Resource\":\"arn:aws:apprunner:${AWS_REGION}:${ACCOUNT}:service/bethere-api*/*\"}]}"
