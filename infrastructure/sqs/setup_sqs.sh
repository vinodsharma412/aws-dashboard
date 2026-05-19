#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Amazon SQS — scraping job queue setup for one deployment stage
#
#  What this creates:
#  ─────────────────
#  1. Dead Letter Queue (DLQ):  nse-scraping-jobs-{stage}-dlq
#     • Receives messages that fail 3 times from the main queue.
#     • 14-day retention so failed jobs are preserved for investigation.
#
#  2. Main Queue:  nse-scraping-jobs-{stage}
#     • Standard queue (not FIFO — order does not matter for scraping).
#     • 300-second visibility timeout matches the Playwright scrape timeout.
#     • Redrive policy: after 3 receive attempts → moves to DLQ.
#
#  Why SQS over in-memory queue?
#  ──────────────────────────────
#  • Durability: messages survive EC2 restarts / deployments.
#  • Decoupling: the API and worker are independent processes.
#  • Visibility: CloudWatch can monitor queue depth and alert on DLQ depth.
#  • Retry: automatic retry with backoff without any application code.
#
#  Free tier:  1 million SQS requests/month forever.
#  With 20-second long-polling: ~130k requests/month — well within free.
#
#  Usage:
#    bash infrastructure/sqs/setup_sqs.sh <stage>
#
#  Example:
#    bash infrastructure/sqs/setup_sqs.sh dev
#    bash infrastructure/sqs/setup_sqs.sh prod
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

STAGE="${1:?Usage: $0 <stage>  (dev | qc | prod)}"
REGION="ap-south-1"
MAIN_QUEUE="nse-scraping-jobs-${STAGE}"
DLQ_NAME="nse-scraping-jobs-${STAGE}-dlq"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NSE SQS Setup — stage: ${STAGE}"
echo "  Region: ${REGION}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# ── Step 1: Create the Dead Letter Queue ─────────────────────────────────────
echo ""
echo "[1/3] Creating DLQ: ${DLQ_NAME}"

DLQ_URL=$(aws sqs create-queue \
  --queue-name "${DLQ_NAME}" \
  --attributes '{
    "MessageRetentionPeriod": "1209600",
    "VisibilityTimeout": "300",
    "Tags": {"Stage": "'"${STAGE}"'", "Project": "nse-dashboard", "Purpose": "scraping-dlq"}
  }' \
  --region "${REGION}" \
  --query "QueueUrl" --output text 2>/dev/null || \
  aws sqs get-queue-url --queue-name "${DLQ_NAME}" --region "${REGION}" --query "QueueUrl" --output text)

DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url "${DLQ_URL}" \
  --attribute-names QueueArn \
  --region "${REGION}" \
  --query "Attributes.QueueArn" --output text)

echo "  ✓  DLQ URL: ${DLQ_URL}"
echo "  ✓  DLQ ARN: ${DLQ_ARN}"

# ── Step 2: Create the Main Queue with redrive policy ────────────────────────
echo ""
echo "[2/3] Creating main queue: ${MAIN_QUEUE}"
echo "      Visibility timeout: 300 s (matches Playwright scrape max time)"
echo "      Max receive count:  3 (after 3 failures → DLQ)"

MAIN_URL=$(aws sqs create-queue \
  --queue-name "${MAIN_QUEUE}" \
  --attributes '{
    "VisibilityTimeout": "300",
    "MessageRetentionPeriod": "345600",
    "ReceiveMessageWaitTimeSeconds": "20",
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"'"${DLQ_ARN}"'\",\"maxReceiveCount\":\"3\"}",
    "Tags": {"Stage": "'"${STAGE}"'", "Project": "nse-dashboard", "Purpose": "scraping-jobs"}
  }' \
  --region "${REGION}" \
  --query "QueueUrl" --output text 2>/dev/null || \
  aws sqs get-queue-url --queue-name "${MAIN_QUEUE}" --region "${REGION}" --query "QueueUrl" --output text)

echo "  ✓  Queue URL: ${MAIN_URL}"

# ── Step 3: Save URL to SSM ──────────────────────────────────────────────────
echo ""
echo "[3/3] Storing queue URL in SSM Parameter Store"

aws ssm put-parameter \
  --name "/nse/${STAGE}/sqs-jobs-url" \
  --value "${MAIN_URL}" \
  --type "String" \
  --description "SQS scraping jobs queue URL for stage ${STAGE}" \
  --overwrite \
  --region "${REGION}" > /dev/null

echo "  ✓  /nse/${STAGE}/sqs-jobs-url stored in SSM"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " SQS setup complete for stage: ${STAGE}"
echo ""
echo " Main queue URL:"
echo "   ${MAIN_URL}"
echo ""
echo " DLQ URL:"
echo "   ${DLQ_URL}"
echo ""
echo " DLQ ARN (for CloudWatch Alarm):"
echo "   ${DLQ_ARN}"
echo ""
echo " The queue URL has been stored in SSM."
echo " FastAPI reads it at startup automatically."
echo ""
echo " Next steps:"
echo "  1. Run infrastructure/sns/setup_sns.sh ${STAGE}"
echo "  2. Run infrastructure/cloudwatch/setup_alarms.sh ${STAGE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
