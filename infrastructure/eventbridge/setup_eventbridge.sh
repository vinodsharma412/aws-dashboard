#!/bin/bash
# Create EventBridge scheduled rules for background automation.
# Run from LOCAL machine (AWS CLI configured with sufficient IAM permissions).
#
# Usage:
#   bash infrastructure/eventbridge/setup_eventbridge.sh <stage>
#   bash infrastructure/eventbridge/setup_eventbridge.sh dev
#   bash infrastructure/eventbridge/setup_eventbridge.sh qc
#   bash infrastructure/eventbridge/setup_eventbridge.sh prod
#
# Rules created (all names include the stage suffix):
#   nse-universe-daily-refresh-{stage}  — 3 AM IST daily
#   nse-screener-30min-{stage}          — every 30 min market hours (Mon-Fri)
#   nse-ec2-state-change-{stage}        — EC2 stop/terminate alert
#   nse-job-completed-{stage}           — custom scraping completion event

set -euo pipefail

STAGE="${1:?Usage: setup_eventbridge.sh <stage>  (dev|qc|prod)}"
REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Lambda function names follow the pattern nse-<function>-<stage>
UNIVERSE_FN="nse-universe-refresh-${STAGE}"
SCREENER_FN="nse-screener-refresh-${STAGE}"

echo "========================================================"
echo " Setting up EventBridge rules — stage: $STAGE"
echo " Region: $REGION  Account: $ACCOUNT_ID"
echo "========================================================"
echo ""

# ── IAM role for EventBridge → Lambda ────────────────────────────────────────
echo "[1/5] EventBridge → Lambda execution role..."

aws iam create-role \
  --role-name NSEEventBridgeRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "events.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' 2>/dev/null || echo "  Role already exists."

aws iam put-role-policy \
  --role-name NSEEventBridgeRole \
  --policy-name NSEEventBridgeLambdaInvoke \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": \"lambda:InvokeFunction\",
      \"Resource\": \"arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:nse-*\"
    }]
  }"

echo "  ✓ Role: NSEEventBridgeRole"

# ── Helper: attach Lambda target to a rule ────────────────────────────────────
attach_lambda_target() {
  local rule_name="$1"
  local function_name="$2"
  local statement_id="$3"

  LAMBDA_ARN=$(aws lambda get-function \
    --function-name "$function_name" \
    --region "$REGION" \
    --query "Configuration.FunctionArn" --output text 2>/dev/null || echo "")

  if [ -z "$LAMBDA_ARN" ] || [ "$LAMBDA_ARN" = "None" ]; then
    echo "  ⚠  Lambda $function_name not deployed yet — add target manually after deploy"
    return
  fi

  aws events put-targets \
    --rule "$rule_name" \
    --targets "Id=LambdaTarget,Arn=${LAMBDA_ARN}" \
    --region "$REGION" > /dev/null

  aws lambda add-permission \
    --function-name "$function_name" \
    --statement-id "$statement_id" \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${rule_name}" \
    --region "$REGION" > /dev/null 2>&1 || true   # idempotent — ignore duplicate

  echo "  ✓ Target attached: $function_name"
}

# ── Rule 1: Daily NSE universe refresh — 3 AM IST = 21:30 UTC ────────────────
echo "[2/5] Rule: Daily universe refresh (3 AM IST)..."

UNIVERSE_RULE="nse-universe-daily-refresh-${STAGE}"
aws events put-rule \
  --name "$UNIVERSE_RULE" \
  --description "Download NSE EQUITY_L.csv and refresh symbol list — stage: ${STAGE}" \
  --schedule-expression "cron(30 21 * * ? *)" \
  --state ENABLED \
  --region "$REGION" > /dev/null

echo "  ✓ Rule: $UNIVERSE_RULE  (21:30 UTC = 3:00 AM IST)"

attach_lambda_target "$UNIVERSE_RULE" "$UNIVERSE_FN" "nse-universe-daily-${STAGE}"

# ── Rule 2: Screener refresh every 30 min during market hours ────────────────
echo "[3/5] Rule: Screener refresh (30 min, Mon-Fri 3:45–10:00 UTC = 9:15–15:30 IST)..."

SCREENER_RULE="nse-screener-30min-${STAGE}"
aws events put-rule \
  --name "$SCREENER_RULE" \
  --description "Pre-compute stock screener every 30 min during NSE market hours — stage: ${STAGE}" \
  --schedule-expression "cron(0/30 3-10 ? * MON-FRI *)" \
  --state ENABLED \
  --region "$REGION" > /dev/null

echo "  ✓ Rule: $SCREENER_RULE"

attach_lambda_target "$SCREENER_RULE" "$SCREENER_FN" "nse-screener-30min-${STAGE}"

# ── Rule 3: EC2 state change → SNS alert ──────────────────────────────────────
echo "[4/5] Rule: EC2 state change alert..."

EC2_RULE="nse-ec2-state-change-${STAGE}"
aws events put-rule \
  --name "$EC2_RULE" \
  --description "Alert when NSE EC2 instance stops or terminates — stage: ${STAGE}" \
  --event-pattern '{
    "source": ["aws.ec2"],
    "detail-type": ["EC2 Instance State-change Notification"],
    "detail": {
      "state": ["stopped", "terminated", "stopping"]
    }
  }' \
  --state ENABLED \
  --region "$REGION" > /dev/null

# Route EC2 alerts to SNS if the ARN is stored in SSM
SNS_ARN=$(aws ssm get-parameter \
  --name "/nse/${STAGE}/sns-alerts-arn" \
  --query "Parameter.Value" --output text 2>/dev/null || echo "")

if [ -n "$SNS_ARN" ] && [ "$SNS_ARN" != "None" ]; then
  aws events put-targets \
    --rule "$EC2_RULE" \
    --targets "Id=SnsTarget,Arn=${SNS_ARN}" \
    --region "$REGION" > /dev/null
  echo "  ✓ Rule: $EC2_RULE  →  SNS"
else
  echo "  ✓ Rule: $EC2_RULE  (SNS not configured yet — run setup_sns.sh first)"
fi

# ── Rule 4: Custom event bus rule — scraping job completed ────────────────────
echo "[5/5] Custom event rule: ScrapingJobCompleted..."

JOB_RULE="nse-job-completed-${STAGE}"
aws events put-rule \
  --name "$JOB_RULE" \
  --description "React to custom scraping job completion events — stage: ${STAGE}" \
  --event-pattern "{
    \"source\": [\"nse.scraping.${STAGE}\"],
    \"detail-type\": [\"JobCompleted\"]
  }" \
  --state ENABLED \
  --region "$REGION" > /dev/null

echo "  ✓ Rule: $JOB_RULE"

echo ""
echo "========================================================"
echo " EventBridge setup complete — stage: $STAGE"
echo ""
echo " Rules created:"
echo "   $UNIVERSE_RULE   (21:30 UTC daily)"
echo "   $SCREENER_RULE   (0/30 3-10 UTC Mon-Fri)"
echo "   $EC2_RULE        (stop/terminate events)"
echo "   $JOB_RULE        (custom scraping events)"
echo ""
echo " View: AWS Console → EventBridge → Rules (filter: nse-*-${STAGE})"
echo ""
echo " If Lambda targets showed ⚠ above, deploy the Lambdas first:"
echo "   bash infrastructure/lambda/universe_refresh/deploy.sh $STAGE"
echo "   bash infrastructure/lambda/screener_refresh/deploy.sh $STAGE"
echo " Then re-run this script — it is idempotent."
echo "========================================================"
