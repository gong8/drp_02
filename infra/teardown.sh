#!/usr/bin/env bash
# Tear down the ENTIRE BeThere backend (prod + dev) on AWS, to stop all billing.
# Used on 2026-06-22 (DRP-75). Name-based (looks resources up by name, never by a
# hardcoded ARN), so it also works on any future rebuild from aws-deploy*.sh.
#
# Order matters: the App Runner services must go before the shared VPC connector they
# use; RDS before its subnet group; security groups last (after the ENIs that reference
# them release). Touches ONLY bethere-* resources - never the knownissue-* databases or
# the sst-asset ECR repo that also live in this account.
set -uo pipefail
export AWS_REGION=us-east-1

echo "== App Runner services (prod + dev) =="
for NAME in bethere-api bethere-api-dev; do
  ARN=$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='$NAME'].ServiceArn | [0]" --output text)
  if [ "$ARN" != "None" ] && [ -n "$ARN" ]; then
    aws apprunner delete-service --service-arn "$ARN" >/dev/null && echo "  deleting $NAME"
  fi
done
# Wait for both to fully drain before deleting the VPC connector they share.
for NAME in bethere-api bethere-api-dev; do
  while [ "$(aws apprunner list-services --query "ServiceSummaryList[?ServiceName=='$NAME'] | length(@)" --output text)" != "0" ]; do sleep 15; done
done

echo "== VPC connector (retry while ENIs release) =="
CONN_ARN=$(aws apprunner list-vpc-connectors --query "VpcConnectors[?VpcConnectorName=='bethere-vpc-conn'].VpcConnectorArn | [0]" --output text)
if [ "$CONN_ARN" != "None" ] && [ -n "$CONN_ARN" ]; then
  for i in $(seq 1 15); do
    aws apprunner delete-vpc-connector --vpc-connector-arn "$CONN_ARN" >/dev/null 2>&1 && { echo "  deleted connector"; break; }
    echo "  connector not deletable yet (attempt $i)..."; sleep 15
  done
fi

echo "== RDS instances (no final snapshot) =="
for DB in bethere-db bethere-db-dev; do
  aws rds delete-db-instance --db-instance-identifier "$DB" --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1 && echo "  deleting $DB" || true
done
for DB in bethere-db bethere-db-dev; do
  aws rds wait db-instance-deleted --db-instance-identifier "$DB" 2>/dev/null || true
done
aws rds delete-db-subnet-group --db-subnet-group-name bethere-subnets 2>/dev/null && echo "  deleted subnet group" || true

echo "== ECR repo (force - includes images) =="
aws ecr delete-repository --repository-name bethere-api --force >/dev/null 2>&1 && echo "  deleted bethere-api" || true

echo "== IAM role + CI user =="
aws iam detach-role-policy --role-name bethere-apprunner-ecr-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess 2>/dev/null || true
aws iam delete-role --role-name bethere-apprunner-ecr-role 2>/dev/null && echo "  deleted role" || true
for AK in $(aws iam list-access-keys --user-name bethere-ci --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null); do
  aws iam delete-access-key --user-name bethere-ci --access-key-id "$AK" || true
done
aws iam delete-user-policy --user-name bethere-ci --policy-name bethere-ci-ecr-push 2>/dev/null || true
aws iam delete-user --user-name bethere-ci 2>/dev/null && echo "  deleted bethere-ci" || true

echo "== Security groups (RDS-SG first; it references the App Runner SG. Retry while ENIs detach) =="
del_sg() {
  local name="$1" id
  id=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$name" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null)
  if [ "$id" = "None" ] || [ -z "$id" ]; then echo "  $name already gone"; return 0; fi
  for i in $(seq 1 20); do
    aws ec2 delete-security-group --group-id "$id" 2>/dev/null && { echo "  deleted $name ($id)"; return 0; }
    echo "  $name not deletable yet (attempt $i, ENIs releasing)..."; sleep 20
  done
  echo "  WARN: could not delete $name ($id) - retry manually once its ENIs release"
}
del_sg bethere-rds-sg
del_sg bethere-apprunner-sg

echo "== CloudWatch log groups =="
for LG in $(aws logs describe-log-groups --log-group-name-prefix '/aws/apprunner/bethere-api' --query 'logGroups[].logGroupName' --output text 2>/dev/null); do
  aws logs delete-log-group --log-group-name "$LG" && echo "  deleted $LG"
done

echo "teardown complete"
