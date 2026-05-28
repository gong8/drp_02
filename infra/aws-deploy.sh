#!/usr/bin/env bash
# Provision the BeThere API on AWS App Runner + RDS Postgres (us-east-1).
#
# This is the reproducible record of how the live backend was stood up. It is
# idempotent-ish but NOT re-run blindly - most steps fail if the resource already
# exists. Run sections as needed. Requires the AWS CLI authenticated with rights to
# create EC2/RDS/IAM/App Runner/ECR resources, plus Docker.
#
# Architecture: App Runner (image from ECR) --VPC connector--> private RDS Postgres.
set -euo pipefail

export AWS_REGION=us-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
# Three subnets across AZs (RDS subnet group needs >=2 AZs; App Runner connector reuses them).
SUBNETS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" \
  --query 'Subnets[?MapPublicIpOnLaunch==`true`].SubnetId | [0:3]' --output text)

# --- Security groups: App Runner egress SG may reach RDS SG on 5432 ---
RDS_SG=$(aws ec2 create-security-group --group-name bethere-rds-sg \
  --description "BeThere RDS" --vpc-id "$VPC_ID" --query GroupId --output text)
AR_SG=$(aws ec2 create-security-group --group-name bethere-apprunner-sg \
  --description "BeThere App Runner egress" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$RDS_SG" \
  --protocol tcp --port 5432 --source-group "$AR_SG"

# --- RDS Postgres (private) ---
aws rds create-db-subnet-group --db-subnet-group-name bethere-subnets \
  --db-subnet-group-description "BeThere" --subnet-ids $SUBNETS
DB_PASS=$(openssl rand -hex 24)   # store somewhere safe; goes into DATABASE_URL below
aws rds create-db-instance \
  --db-instance-identifier bethere-db \
  --engine postgres --engine-version 16.14 \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 --storage-type gp3 \
  --master-username bethere --master-user-password "$DB_PASS" \
  --db-name bethere \
  --vpc-security-group-ids "$RDS_SG" \
  --db-subnet-group-name bethere-subnets \
  --no-publicly-accessible --backup-retention-period 1 --no-multi-az \
  --no-enable-performance-insights
aws rds wait db-instance-available --db-instance-identifier bethere-db
RDS_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier bethere-db \
  --query 'DBInstances[0].Endpoint.Address' --output text)

# --- ECR repo + first image push (App Runner pulls from here) ---
ECR_URI=$(aws ecr create-repository --repository-name bethere-api \
  --query 'repository.repositoryUri' --output text)
aws ecr get-login-password | docker login --username AWS --password-stdin "${ECR_URI%%/*}"
# --provenance=false => a single Docker v2 manifest (App Runner can't pull a buildx OCI index).
docker build --platform linux/amd64 --provenance=false \
  -f apps/api/Dockerfile -t "${ECR_URI}:latest" .
docker push "${ECR_URI}:latest"

# --- IAM access role: lets App Runner pull the private ECR image ---
ROLE_ARN=$(aws iam create-role --role-name bethere-apprunner-ecr-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --query 'Role.Arn' --output text)
aws iam attach-role-policy --role-name bethere-apprunner-ecr-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess

# --- VPC connector: puts App Runner egress on the VPC so it can reach private RDS ---
CONN_ARN=$(aws apprunner create-vpc-connector --vpc-connector-name bethere-vpc-conn \
  --subnets $SUBNETS --security-groups "$AR_SG" \
  --query 'VpcConnector.VpcConnectorArn' --output text)

# --- App Runner service ---
DATABASE_URL="postgres://bethere:${DB_PASS}@${RDS_ENDPOINT}:5432/bethere"
cat > /tmp/apprunner.json <<JSON
{
  "ServiceName": "bethere-api",
  "SourceConfiguration": {
    "AuthenticationConfiguration": { "AccessRoleArn": "${ROLE_ARN}" },
    "AutoDeploymentsEnabled": true,
    "ImageRepository": {
      "ImageIdentifier": "${ECR_URI}:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "DATABASE_URL": "${DATABASE_URL}",
          "SEED_ON_BOOT": "if-empty"
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
aws apprunner create-service --cli-input-json file:///tmp/apprunner.json \
  --query 'Service.ServiceUrl' --output text

# --- CI user for GitHub Actions (ECR push only; never the root keys) ---
aws iam create-user --user-name bethere-ci
aws iam put-user-policy --user-name bethere-ci --policy-name bethere-ci-ecr-push \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ecr:GetAuthorizationToken\",\"Resource\":\"*\"},{\"Effect\":\"Allow\",\"Action\":[\"ecr:BatchCheckLayerAvailability\",\"ecr:InitiateLayerUpload\",\"ecr:UploadLayerPart\",\"ecr:CompleteLayerUpload\",\"ecr:PutImage\",\"ecr:BatchGetImage\"],\"Resource\":\"arn:aws:ecr:${AWS_REGION}:${ACCOUNT}:repository/bethere-api\"}]}"
# Then: aws iam create-access-key --user-name bethere-ci
#       gh secret set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY -R gong8/drp_02
