#!/bin/bash
# CloudWatch setup — log groups, alarms, dashboard, CloudWatch Agent on EC2.
# Step 1: Run on LOCAL machine to create log groups + alarms.
# Step 2: Run install_agent.sh on EC2 to ship logs.

set -e

REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
SNS_EMAIL="${1:-}"   # Optional: pass your email for alarm notifications

echo "Setting up CloudWatch in $REGION (account: $ACCOUNT_ID)"
echo ""

# ── Log Groups ─────────────────────────────────────────────────────────────────
echo "[1/5] Creating log groups..."

for group in "/nse/api" "/nse/worker" "/aws/apigateway/nse-stock-api"; do
  aws logs create-log-group \
    --log-group-name "$group" \
    --region "$REGION" 2>/dev/null && echo "  Created: $group" || echo "  Exists:  $group"

  # Retain logs for 30 days (free: 5 GB/month ingestion + 5 GB storage)
  aws logs put-retention-policy \
    --log-group-name "$group" \
    --retention-in-days 30 \
    --region "$REGION"
done

# ── SNS Topic for alarms ───────────────────────────────────────────────────────
echo "[2/5] Creating SNS topic for alarms..."
SNS_ARN=$(aws sns create-topic \
  --name "nse-alarms" \
  --region "$REGION" \
  --query "TopicArn" --output text)
echo "  SNS ARN: $SNS_ARN"

if [ -n "$SNS_EMAIL" ]; then
  aws sns subscribe \
    --topic-arn "$SNS_ARN" \
    --protocol email \
    --notification-endpoint "$SNS_EMAIL" \
    --region "$REGION" > /dev/null
  echo "  Subscription confirmation sent to: $SNS_EMAIL"
fi

# ── CloudWatch Alarms ──────────────────────────────────────────────────────────
echo "[3/5] Creating CloudWatch alarms..."

# Get EC2 instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=nse-stock-server" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text --region "$REGION" 2>/dev/null || echo "")

if [ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != "None" ]; then
  # CPU > 80% for 5 minutes
  aws cloudwatch put-metric-alarm \
    --alarm-name "NSE-EC2-HighCPU" \
    --alarm-description "EC2 CPU > 80% for 5 min — API may be overloaded" \
    --metric-name CPUUtilization \
    --namespace AWS/EC2 \
    --statistic Average \
    --period 300 \
    --threshold 80 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 1 \
    --dimensions Name=InstanceId,Value="$INSTANCE_ID" \
    --alarm-actions "$SNS_ARN" \
    --ok-actions "$SNS_ARN" \
    --region "$REGION"
  echo "  Alarm: NSE-EC2-HighCPU (> 80%)"
else
  echo "  SKIP: EC2 instance 'nse-stock-server' not found. Create it first."
fi

# API Gateway 5xx errors > 10 per minute
API_ID=$(aws apigatewayv2 get-apis \
  --region "$REGION" \
  --query "Items[?Name=='nse-stock-api'].ApiId | [0]" \
  --output text 2>/dev/null || echo "")

if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
  aws cloudwatch put-metric-alarm \
    --alarm-name "NSE-API-5xxErrors" \
    --alarm-description "API Gateway 5xx errors > 10/min — backend may be down" \
    --metric-name 5XXError \
    --namespace AWS/ApiGateway \
    --statistic Sum \
    --period 60 \
    --threshold 10 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 1 \
    --dimensions Name=ApiId,Value="$API_ID" \
    --alarm-actions "$SNS_ARN" \
    --region "$REGION"
  echo "  Alarm: NSE-API-5xxErrors (> 10/min)"
fi

# DynamoDB throttles > 0 (free tier has 25 RCU/WCU — throttles = we're over limit)
aws cloudwatch put-metric-alarm \
  --alarm-name "NSE-DynamoDB-Throttles" \
  --alarm-description "DynamoDB throttling — approaching free tier limit" \
  --metric-name SystemErrors \
  --namespace AWS/DynamoDB \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --alarm-actions "$SNS_ARN" \
  --region "$REGION"
echo "  Alarm: NSE-DynamoDB-Throttles (any throttle)"

# ── CloudWatch Dashboard ───────────────────────────────────────────────────────
echo "[4/5] Creating CloudWatch Dashboard..."

cat > /tmp/nse-dashboard.json << DASHBOARD
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "title": "EC2 CPU Utilization",
        "metrics": [["AWS/EC2", "CPUUtilization", "InstanceId", "${INSTANCE_ID:-PLACEHOLDER}"]],
        "period": 300, "stat": "Average", "view": "timeSeries",
        "yAxis": {"left": {"min": 0, "max": 100}}
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "API Gateway — Requests & Errors",
        "metrics": [
          ["AWS/ApiGateway", "Count", "ApiId", "${API_ID:-PLACEHOLDER}", {"label": "Total Requests"}],
          ["AWS/ApiGateway", "5XXError", "ApiId", "${API_ID:-PLACEHOLDER}", {"label": "5xx Errors"}],
          ["AWS/ApiGateway", "4XXError", "ApiId", "${API_ID:-PLACEHOLDER}", {"label": "4xx Errors"}]
        ],
        "period": 60, "stat": "Sum", "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "API Gateway — Latency (ms)",
        "metrics": [["AWS/ApiGateway", "Latency", "ApiId", "${API_ID:-PLACEHOLDER}"]],
        "period": 60, "stat": "p99", "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "DynamoDB — Consumed RCU / WCU",
        "metrics": [
          ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", "users"],
          ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", "users"],
          ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", "scraping_tasks"],
          ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", "scraping_tasks"]
        ],
        "period": 300, "stat": "Sum", "view": "timeSeries"
      }
    },
    {
      "type": "log",
      "properties": {
        "title": "API Errors (last 30 min)",
        "query": "SOURCE '/nse/api' | fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20",
        "region": "${REGION}", "view": "table"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "S3 — Frontend Requests",
        "metrics": [
          ["AWS/S3", "NumberOfObjects", "BucketName", "nse-frontend-${ACCOUNT_ID}", "StorageType", "AllStorageTypes"]
        ],
        "period": 86400, "stat": "Average", "view": "singleValue"
      }
    }
  ]
}
DASHBOARD

aws cloudwatch put-dashboard \
  --dashboard-name "NSE-Stock-Dashboard" \
  --dashboard-body file:///tmp/nse-dashboard.json \
  --region "$REGION" > /dev/null
echo "  Dashboard: NSE-Stock-Dashboard"

echo "[5/5] Done!"
echo ""
echo "========================================================"
echo " View in AWS Console:"
echo " CloudWatch → Dashboards → NSE-Stock-Dashboard"
echo " CloudWatch → Alarms (3 alarms created)"
echo " CloudWatch → Log groups:"
echo "   /nse/api     ← FastAPI logs"
echo "   /nse/worker  ← Worker logs"
echo ""
echo " Next: Install CloudWatch Agent on EC2"
echo "   bash infrastructure/cloudwatch/install_agent_on_ec2.sh"
echo "========================================================"
