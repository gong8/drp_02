#!/usr/bin/env bash
# Tear down everything aws-deploy.sh created, to stop all billing. Order matters:
# the App Runner service must go before the VPC connector, RDS before its subnet group.
set -uo pipefail
export AWS_REGION=us-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

SERVICE_ARN=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='bethere-api'].ServiceArn | [0]" --output text)
[ "$SERVICE_ARN" != "None" ] && aws apprunner delete-service --service-arn "$SERVICE_ARN"
# Wait for the service to drain before deleting the VPC connector it uses.
while [ "$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='bethere-api'] | length(@)" --output text)" != "0" ]; do sleep 15; done

CONN_ARN=$(aws apprunner list-vpc-connectors --query "VpcConnectors[?VpcConnectorName=='bethere-vpc-conn'].VpcConnectorArn | [0]" --output text)
[ "$CONN_ARN" != "None" ] && aws apprunner delete-vpc-connector --vpc-connector-arn "$CONN_ARN"

aws rds delete-db-instance --db-instance-identifier bethere-db --skip-final-snapshot --delete-automated-backups || true
aws rds wait db-instance-deleted --db-instance-identifier bethere-db || true
aws rds delete-db-subnet-group --db-subnet-group-name bethere-subnets || true

aws ecr delete-repository --repository-name bethere-api --force || true

aws iam detach-role-policy --role-name bethere-apprunner-ecr-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess || true
aws iam delete-role --role-name bethere-apprunner-ecr-role || true

for AK in $(aws iam list-access-keys --user-name bethere-ci --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
  aws iam delete-access-key --user-name bethere-ci --access-key-id "$AK"
done
aws iam delete-user-policy --user-name bethere-ci --policy-name bethere-ci-ecr-push || true
aws iam delete-user --user-name bethere-ci || true

# Security groups last (after the things using their ENIs are gone).
RDS_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=bethere-rds-sg --query 'SecurityGroups[0].GroupId' --output text)
AR_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=bethere-apprunner-sg --query 'SecurityGroups[0].GroupId' --output text)
[ "$RDS_SG" != "None" ] && aws ec2 delete-security-group --group-id "$RDS_SG" || true
[ "$AR_SG" != "None" ] && aws ec2 delete-security-group --group-id "$AR_SG" || true
echo "teardown complete"
