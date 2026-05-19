#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  CloudWatch Alarms — operational monitoring for one deployment stage
#
#  What this creates (6 alarms + 1 dashboard):
#  ───────────────────────────────────────────
#  1. nse-sqs-dlq-depth-{stage}     DLQ visible messages > 0
#     → A scraper job failed 3 times (bug or site block).
#
#  2. nse-lambda-screener-errors-{stage}  Lambda errors > 0 in 5 min
#     → Screener refresh broken — cached results will go stale.
#
#  3. nse-lambda-universe-errors-{stage}  Lambda errors > 0 in 5 min
#     → Universe refresh broken — symbol list not updated.
#
#  4. nse-ec2-cpu-high-{stage}      EC2 CPU > 80% for 10 min
#     → Server under load — consider scaling.
#
#  5. nse-ec2-status-failed-{stage} EC2 status check failed
#     → Instance unreachable — investigate immediately.
#
#  6. nse-apigw-5xx-{stage}         API Gateway 5XX errors > 10 in 5 min
#     → Backend returning server errors to users.
#
#  Dashboard: NSE-Operations-{stage}
#     Unified view: Lambda, SQS, EC2, API Gateway, DynamoDB.
#
#  All alarms publish to SNS topic nse-alerts-{stage}.
#  Run infrastructure/sns/setup_sns.sh first to create that topic.
#
#  Free tier:
#    CloudWatch: 10 detailed monitoring metrics free.
#    10 alarms free.  Basic EC2 monitoring (5 min interval) is always free.
#
#  Usage:
#    bash infrastructure/cloudwatch/setup_alarms.sh <stage> <ec2-instance-id> <api-gw-id>
#
#  Example:
#    bash infrastructure/cloudwatch/setup_alarms.sh prod i-0abc123 y04lj0toia
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

STAGE="${1:?Usage: $0 <stage> <ec2-instance-id> <api-gw-id>}"
EC2_INSTANCE="${2:?Provide EC2 instance ID, e.g. i-0abc123}"
API_GW_ID="${3:-y04lj0toia}"
REGION="ap-south-1"
DLQ_NAME="nse-scraping-jobs-${STAGE}-dlq"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CloudWatch Alarms — stage: ${STAGE}"
echo "  EC2: ${EC2_INSTANCE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Resolve SNS ARN from SSM
SNS_ARN=$(aws ssm get-parameter \
  --name "/nse/${STAGE}/sns-alerts-arn" \
  --query "Parameter.Value" --output text \
  --region "${REGION}" 2>/dev/null || echo "")

if [ -z "$SNS_ARN" ]; then
  echo "ERROR: /nse/${STAGE}/sns-alerts-arn not found in SSM."
  echo "       Run infrastructure/sns/setup_sns.sh ${STAGE} <email> first."
  exit 1
fi

echo "  SNS ARN: ${SNS_ARN}"

# ── Alarm 1: SQS DLQ depth ───────────────────────────────────────────────────
echo ""
echo "[1/6] Alarm: SQS DLQ depth > 0 (scraper job permanently failed)"

aws cloudwatch put-metric-alarm \
  --alarm-name "nse-sqs-dlq-depth-${STAGE}" \
  --alarm-description "Scraping job failed 3 times and landed in DLQ. Investigate ASIN or site block." \
  --metric-name "ApproximateNumberOfMessagesVisible" \
  --namespace "AWS/SQS" \
  --dimensions Name=QueueName,Value="${DLQ_NAME}" \
  --statistic Maximum \
  --period 60 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions "${SNS_ARN}" \
  --ok-actions "${SNS_ARN}" \
  --treat-missing-data notBreaching \
  --region "${REGION}"
echo "  ✓  nse-sqs-dlq-depth-${STAGE}"

# ── Alarm 2: Screener Lambda errors ──────────────────────────────────────────
echo "[2/6] Alarm: Lambda nse-screener-refresh-${STAGE} errors > 0"

aws cloudwatch put-metric-alarm \
  --alarm-name "nse-lambda-screener-errors-${STAGE}" \
  --alarm-description "Screener Lambda failed — cached results will go stale." \
  --metric-name "Errors" \
  --namespace "AWS/Lambda" \
  --dimensions Name=FunctionName,Value="nse-screener-refresh-${STAGE}" \
  --statistic Sum \
  --period 300 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions "${SNS_ARN}" \
  --treat-missing-data notBreaching \
  --region "${REGION}"
echo "  ✓  nse-lambda-screener-errors-${STAGE}"

# ── Alarm 3: Universe Lambda errors ──────────────────────────────────────────
echo "[3/6] Alarm: Lambda nse-universe-refresh-${STAGE} errors > 0"

aws cloudwatch put-metric-alarm \
  --alarm-name "nse-lambda-universe-errors-${STAGE}" \
  --alarm-description "Universe refresh Lambda failed — symbol list not updated." \
  --metric-name "Errors" \
  --namespace "AWS/Lambda" \
  --dimensions Name=FunctionName,Value="nse-universe-refresh-${STAGE}" \
  --statistic Sum \
  --period 300 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions "${SNS_ARN}" \
  --treat-missing-data notBreaching \
  --region "${REGION}"
echo "  ✓  nse-lambda-universe-errors-${STAGE}"

# ── Alarm 4: EC2 CPU ─────────────────────────────────────────────────────────
echo "[4/6] Alarm: EC2 CPU > 80% for 10 min"

aws cloudwatch put-metric-alarm \
  --alarm-name "nse-ec2-cpu-high-${STAGE}" \
  --alarm-description "EC2 CPU sustained above 80% — Playwright scraping may be bottlenecked." \
  --metric-name "CPUUtilization" \
  --namespace "AWS/EC2" \
  --dimensions Name=InstanceId,Value="${EC2_INSTANCE}" \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions "${SNS_ARN}" \
  --ok-actions "${SNS_ARN}" \
  --treat-missing-data missing \
  --region "${REGION}"
echo "  ✓  nse-ec2-cpu-high-${STAGE}"

# ── Alarm 5: EC2 status check ────────────────────────────────────────────────
echo "[5/6] Alarm: EC2 status check failed"

aws cloudwatch put-metric-alarm \
  --alarm-name "nse-ec2-status-failed-${STAGE}" \
  --alarm-description "EC2 instance failed system or instance status check — may be unreachable." \
  --metric-name "StatusCheckFailed" \
  --namespace "AWS/EC2" \
  --dimensions Name=InstanceId,Value="${EC2_INSTANCE}" \
  --statistic Maximum \
  --period 60 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --alarm-actions "${SNS_ARN}" \
  --treat-missing-data missing \
  --region "${REGION}"
echo "  ✓  nse-ec2-status-failed-${STAGE}"

# ── Alarm 6: API Gateway 5XX ─────────────────────────────────────────────────
echo "[6/6] Alarm: API Gateway 5XX errors > 10 in 5 min"

aws cloudwatch put-metric-alarm \
  --alarm-name "nse-apigw-5xx-${STAGE}" \
  --alarm-description "API Gateway returning 5XX errors — backend health issue." \
  --metric-name "5XXError" \
  --namespace "AWS/ApiGateway" \
  --dimensions Name=ApiId,Value="${API_GW_ID}" Name=Stage,Value="${STAGE}" \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions "${SNS_ARN}" \
  --treat-missing-data notBreaching \
  --region "${REGION}"
echo "  ✓  nse-apigw-5xx-${STAGE}"

# ── CloudWatch Dashboard ──────────────────────────────────────────────────────
echo ""
echo "[+] Creating dashboard: NSE-Operations-${STAGE}"

DASHBOARD_BODY=$(cat << ENDDASH
{
  "widgets": [
    {
      "type": "text", "x": 0, "y": 0, "width": 24, "height": 1,
      "properties": {"markdown": "# NSE Dashboard — ${STAGE} Operations"}
    },
    {
      "type": "metric", "x": 0, "y": 1, "width": 8, "height": 6,
      "properties": {
        "title": "Lambda Invocations & Errors",
        "metrics": [
          ["AWS/Lambda","Invocations","FunctionName","nse-screener-refresh-${STAGE}",{"label":"Screener Invocations"}],
          ["AWS/Lambda","Errors","FunctionName","nse-screener-refresh-${STAGE}",{"label":"Screener Errors","color":"#d62728"}],
          ["AWS/Lambda","Invocations","FunctionName","nse-universe-refresh-${STAGE}",{"label":"Universe Invocations"}],
          ["AWS/Lambda","Errors","FunctionName","nse-universe-refresh-${STAGE}",{"label":"Universe Errors","color":"#ff7f0e"}]
        ],
        "period": 300, "stat": "Sum", "view": "timeSeries"
      }
    },
    {
      "type": "metric", "x": 8, "y": 1, "width": 8, "height": 6,
      "properties": {
        "title": "SQS Queue Depth",
        "metrics": [
          ["AWS/SQS","ApproximateNumberOfMessagesVisible","QueueName","nse-scraping-jobs-${STAGE}",{"label":"Jobs Queue"}],
          ["AWS/SQS","ApproximateNumberOfMessagesVisible","QueueName","nse-scraping-jobs-${STAGE}-dlq",{"label":"DLQ (failures)","color":"#d62728"}]
        ],
        "period": 60, "stat": "Maximum", "view": "timeSeries"
      }
    },
    {
      "type": "metric", "x": 16, "y": 1, "width": 8, "height": 6,
      "properties": {
        "title": "EC2 CPU & Status",
        "metrics": [
          ["AWS/EC2","CPUUtilization","InstanceId","${EC2_INSTANCE}",{"label":"CPU %"}],
          ["AWS/EC2","StatusCheckFailed","InstanceId","${EC2_INSTANCE}",{"label":"Status Failed","color":"#d62728"}]
        ],
        "period": 300, "stat": "Average", "view": "timeSeries"
      }
    },
    {
      "type": "metric", "x": 0, "y": 7, "width": 12, "height": 6,
      "properties": {
        "title": "API Gateway Requests & Errors",
        "metrics": [
          ["AWS/ApiGateway","Count","ApiId","${API_GW_ID}","Stage","${STAGE}",{"label":"Total Requests"}],
          ["AWS/ApiGateway","4XXError","ApiId","${API_GW_ID}","Stage","${STAGE}",{"label":"4XX Errors","color":"#ff7f0e"}],
          ["AWS/ApiGateway","5XXError","ApiId","${API_GW_ID}","Stage","${STAGE}",{"label":"5XX Errors","color":"#d62728"}]
        ],
        "period": 300, "stat": "Sum", "view": "timeSeries"
      }
    },
    {
      "type": "metric", "x": 12, "y": 7, "width": 12, "height": 6,
      "properties": {
        "title": "Lambda Duration (ms)",
        "metrics": [
          ["AWS/Lambda","Duration","FunctionName","nse-screener-refresh-${STAGE}",{"label":"Screener p50","stat":"p50"}],
          ["AWS/Lambda","Duration","FunctionName","nse-screener-refresh-${STAGE}",{"label":"Screener p99","stat":"p99"}]
        ],
        "period": 300, "view": "timeSeries"
      }
    }
  ]
}
ENDDASH
)

aws cloudwatch put-dashboard \
  --dashboard-name "NSE-Operations-${STAGE}" \
  --dashboard-body "${DASHBOARD_BODY}" \
  --region "${REGION}" > /dev/null

echo "  ✓  Dashboard: NSE-Operations-${STAGE}"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " CloudWatch setup complete for: ${STAGE}"
echo ""
echo " 6 alarms created — all route to:"
echo "   ${SNS_ARN}"
echo ""
echo " Dashboard URL:"
echo "  https://${REGION}.console.aws.amazon.com/cloudwatch/home"
echo "  → Dashboards → NSE-Operations-${STAGE}"
echo ""
echo " View alarms:"
echo "  AWS Console → CloudWatch → Alarms → filter: nse-*-${STAGE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
