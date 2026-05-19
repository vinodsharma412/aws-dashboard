#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Amazon SNS — operational alerts topic for one deployment stage
#
#  What this creates:
#  ─────────────────
#  Topic:  nse-alerts-{stage}
#    Email subscription  → your admin email address
#
#  Who publishes to this topic:
#    • Lambda nse-dlq-alert        → scraper job failed 3× (DLQ message)
#    • CloudWatch Alarm            → Lambda errors, SQS DLQ depth, EC2 CPU/health
#    • EventBridge rule            → EC2 instance state change (stopped/terminated)
#
#  Free tier:
#    SNS: 1 million publishes/month forever free.
#    Email delivery is always free.
#
#  Usage:
#    bash infrastructure/sns/setup_sns.sh <stage> <admin-email>
#
#  Example:
#    bash infrastructure/sns/setup_sns.sh prod admin@example.com
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

STAGE="${1:?Usage: $0 <stage> <admin-email>}"
ADMIN_EMAIL="${2:?Usage: $0 <stage> <admin-email>}"
REGION="ap-south-1"
TOPIC_NAME="nse-alerts-${STAGE}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NSE SNS Setup — stage: ${STAGE}"
echo "  Region: ${REGION}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: Create SNS topic ─────────────────────────────────────────────────
echo ""
echo "[1/3] Creating SNS topic: ${TOPIC_NAME}"

TOPIC_ARN=$(aws sns create-topic \
  --name "${TOPIC_NAME}" \
  --attributes DisplayName="NSE Dashboard Alerts (${STAGE})" \
  --tags Key=Stage,Value="${STAGE}" Key=Project,Value=nse-dashboard \
  --region "${REGION}" \
  --query "TopicArn" --output text)

echo "  ✓  Topic ARN: ${TOPIC_ARN}"

# ── Step 2: Subscribe admin email ─────────────────────────────────────────────
echo ""
echo "[2/3] Subscribing ${ADMIN_EMAIL} to topic"
echo "      ⚠  AWS will send a confirmation email — you MUST click"
echo "         the confirmation link before alerts are delivered!"

aws sns subscribe \
  --topic-arn "${TOPIC_ARN}" \
  --protocol email \
  --notification-endpoint "${ADMIN_EMAIL}" \
  --region "${REGION}" \
  --query "SubscriptionArn" --output text > /dev/null

echo "  ✓  Subscription created — check ${ADMIN_EMAIL} for confirmation"

# ── Step 3: Store ARN in SSM ─────────────────────────────────────────────────
echo ""
echo "[3/3] Storing topic ARN in SSM Parameter Store"

aws ssm put-parameter \
  --name "/nse/${STAGE}/sns-alerts-arn" \
  --value "${TOPIC_ARN}" \
  --type "String" \
  --description "SNS alerts topic ARN for stage ${STAGE}" \
  --overwrite \
  --region "${REGION}" > /dev/null

echo "  ✓  /nse/${STAGE}/sns-alerts-arn stored in SSM"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " SNS setup complete for stage: ${STAGE}"
echo ""
echo " Topic ARN: ${TOPIC_ARN}"
echo " Admin email: ${ADMIN_EMAIL}"
echo ""
echo " ⚠  ACTION REQUIRED:"
echo "    Check ${ADMIN_EMAIL} and click the confirmation link!"
echo "    Alerts will NOT be delivered until you confirm."
echo ""
echo " Next steps:"
echo "  1. Confirm email subscription"
echo "  2. Run infrastructure/cloudwatch/setup_alarms.sh ${STAGE}"
echo "  3. Deploy Lambda nse-dlq-alert"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
