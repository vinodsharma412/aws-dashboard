#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  NSE Stock Dashboard — complete infrastructure setup for one stage
#
#  This is the MASTER setup script.  Run it once per stage to provision
#  all AWS resources.  Subsequent runs are idempotent — existing resources
#  are not deleted or recreated.
#
#  What it does (in order):
#  ────────────────────────
#  Phase 1: Identity & Access      IAM roles for EC2 and Lambda
#  Phase 2: Storage                S3 buckets + DynamoDB tables
#  Phase 3: Secrets                SSM Parameter Store (JWT, SMTP, etc.)
#  Phase 4: Messaging              SQS queues + SNS topic
#  Phase 5: Compute                Lambda functions (screener, universe, dlq-alert)
#  Phase 6: Scheduling             EventBridge rules
#  Phase 7: Content delivery       CloudFront distribution
#  Phase 8: Observability          CloudWatch alarms + dashboard
#  Phase 9: Audit                  CloudTrail (account-wide, run once)
#
#  Usage:
#    bash infrastructure/scripts/setup_stage.sh <stage> <ec2-ip> <admin-email>
#
#  Examples:
#    bash infrastructure/scripts/setup_stage.sh dev     YOUR_EC2_IP me@email.com
#    bash infrastructure/scripts/setup_stage.sh qc      YOUR_EC2_IP me@email.com
#    bash infrastructure/scripts/setup_stage.sh prod    YOUR_EC2_IP me@email.com
#
#  Prerequisites:
#    • AWS CLI configured with admin credentials (aws configure)
#    • jq installed: sudo apt install jq
#    • Python 3 with boto3: pip install boto3
#
#  Cost: everything within AWS Free Tier for 12 months.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

STAGE="${1:?Usage: $0 <stage> <ec2-ip> <admin-email>}"
EC2_IP="${2:?Provide EC2 IP, e.g. YOUR_EC2_IP}"
ADMIN_EMAIL="${3:?Provide admin email for alerts}"
REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
S3_FRONTEND="nse-frontend-${ACCOUNT_ID}"
S3_ASSETS="nse-assets-${ACCOUNT_ID}-${STAGE}"
INFRA="$(dirname "$0")/.."

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  NSE Stock Dashboard — Infrastructure Setup         ║"
echo "║  Stage: ${STAGE}   Region: ${REGION}               ║"
echo "║  Account: ${ACCOUNT_ID}                            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  This will set up ALL infrastructure for stage: ${STAGE}"
echo "  EC2 IP: ${EC2_IP}"
echo "  Alerts → ${ADMIN_EMAIL}"
echo ""
read -rp "  Press Enter to continue (Ctrl+C to cancel)..."

# ── Phase 1: IAM ──────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Phase 1/9: IAM Roles"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "${INFRA}/iam/setup_ec2_role.sh"
bash "${INFRA}/iam/setup_lambda_role.sh"

# ── Phase 2: Storage ──────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Phase 2/9: S3 + DynamoDB"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "${INFRA}/scripts/s3_setup.sh"
STAGE="${STAGE}" python3 "${INFRA}/dynamodb/create_tables.py"

# ── Phase 3: Secrets ──────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Phase 3/9: SSM Parameter Store (secrets)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "${INFRA}/ssm/setup_ssm.sh" "${STAGE}"

# ── Phase 4: Messaging ────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Phase 4/9: SQS + SNS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "${INFRA}/sqs/setup_sqs.sh" "${STAGE}"
bash "${INFRA}/sns/setup_sns.sh" "${STAGE}" "${ADMIN_EMAIL}"

# ── Phase 5: Lambda ───────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Phase 5/9: Lambda functions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
LAMBDA_ROLE="arn:aws:iam::${ACCOUNT_ID}:role/NSELambdaRole"

# dlq-alert Lambda
cd "${INFRA}/lambda/dlq_alert"
zip -j handler.zip handler.py
aws lambda create-function \
  --function-name "nse-dlq-alert-${STAGE}" \
  --runtime python3.12 \
  --handler handler.lambda_handler \
  --zip-file fileb://handler.zip \
  --role "${LAMBDA_ROLE}" \
  --timeout 30 \
  --memory-size 128 \
  --environment "Variables={STAGE=${STAGE}}" \
  --description "DLQ alert — sends SNS email on scraper failure (${STAGE})" \
  --region "${REGION}" 2>/dev/null || \
aws lambda update-function-code \
  --function-name "nse-dlq-alert-${STAGE}" \
  --zip-file fileb://handler.zip \
  --region "${REGION}" > /dev/null
cd - > /dev/null

# Wire dlq-alert Lambda to DLQ event source
DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url "$(aws sqs get-queue-url \
    --queue-name "nse-scraping-jobs-${STAGE}-dlq" \
    --region "${REGION}" --query "QueueUrl" --output text)" \
  --attribute-names QueueArn \
  --region "${REGION}" \
  --query "Attributes.QueueArn" --output text)

aws lambda create-event-source-mapping \
  --function-name "nse-dlq-alert-${STAGE}" \
  --event-source-arn "${DLQ_ARN}" \
  --batch-size 1 \
  --region "${REGION}" 2>/dev/null || echo "  Event source mapping already exists."

# screener-refresh Lambda
cd "${INFRA}/lambda/screener_refresh"
zip -j handler.zip handler.py
aws lambda create-function \
  --function-name "nse-screener-refresh-${STAGE}" \
  --runtime python3.12 \
  --handler handler.lambda_handler \
  --zip-file fileb://handler.zip \
  --role "${LAMBDA_ROLE}" \
  --timeout 300 \
  --memory-size 256 \
  --environment "Variables={STAGE=${STAGE},EC2_API_URL=http://${EC2_IP}}" \
  --description "Pre-compute screener every 30 min — caches in DynamoDB (${STAGE})" \
  --region "${REGION}" 2>/dev/null || \
aws lambda update-function-code \
  --function-name "nse-screener-refresh-${STAGE}" \
  --zip-file fileb://handler.zip \
  --region "${REGION}" > /dev/null
cd - > /dev/null

# universe-refresh Lambda
cd "${INFRA}/lambda/universe_refresh"
zip -j handler.zip handler.py
aws lambda create-function \
  --function-name "nse-universe-refresh-${STAGE}" \
  --runtime python3.12 \
  --handler handler.lambda_handler \
  --zip-file fileb://handler.zip \
  --role "${LAMBDA_ROLE}" \
  --timeout 60 \
  --memory-size 256 \
  --environment "Variables={STAGE=${STAGE}}" \
  --description "Daily NSE universe refresh — stores symbols in DynamoDB (${STAGE})" \
  --region "${REGION}" 2>/dev/null || \
aws lambda update-function-code \
  --function-name "nse-universe-refresh-${STAGE}" \
  --zip-file fileb://handler.zip \
  --region "${REGION}" > /dev/null
cd - > /dev/null

echo "  ✓  3 Lambda functions deployed for stage ${STAGE}"

# ── Phase 6: EventBridge ──────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Phase 6/9: EventBridge rules"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
STAGE="${STAGE}" bash "${INFRA}/eventbridge/setup_eventbridge.sh"

# ── Phase 7: CloudFront ───────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Phase 7/9: CloudFront CDN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "${INFRA}/cloudfront/setup_cloudfront.sh" "${STAGE}" "${S3_FRONTEND}"

# ── Phase 8: CloudWatch ───────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Phase 8/9: CloudWatch alarms + dashboard"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
EC2_INSTANCE=$(aws ec2 describe-instances \
  --filters "Name=ip-address,Values=${EC2_IP}" \
  --query "Reservations[0].Instances[0].InstanceId" --output text \
  --region "${REGION}" 2>/dev/null || echo "")
API_GW_ID=$(aws ssm get-parameter --name "/nse/${STAGE}/api-gw-id" \
  --query "Parameter.Value" --output text --region "${REGION}" 2>/dev/null || echo "")
bash "${INFRA}/cloudwatch/setup_alarms.sh" "${STAGE}" "${EC2_INSTANCE:-i-unknown}" "${API_GW_ID:-none}"

# ── Phase 9: CloudTrail (account-wide, run once) ──────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Phase 9/9: CloudTrail audit logging (account-wide)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bash "${INFRA}/cloudtrail/setup_cloudtrail.sh"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✓  Infrastructure setup complete!                  ║"
echo "║  Stage: ${STAGE}                                    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo " Next steps:"
echo "  1. Confirm the SNS subscription email sent to ${ADMIN_EMAIL}"
echo "  2. Deploy backend code: make deploy STAGE=${STAGE}"
echo "  3. Deploy frontend:     make deploy-frontend STAGE=${STAGE}"
echo "  4. Verify:              make health EC2_HOST=${EC2_IP}"
