#!/bin/bash
# Run health checks on both local and AWS services.
#
# Usage:
#   bash infrastructure/scripts/health_check.sh [ec2-host]
#   make health

set -e

EC2_HOST="${1:-}"
REGION="ap-south-1"

PASS="✓"
FAIL="✗"
WARN="!"

ok()   { echo "  $PASS $1"; }
fail() { echo "  $FAIL $1"; FAILED=1; }
warn() { echo "  $WARN $1"; }

FAILED=0

echo ""
echo "══════════════════════════════════════════"
echo "  NSE Dashboard — Health Check"
echo "══════════════════════════════════════════"

# ── Local API ──────────────────────────────────────────────────────────────────
echo ""
echo "[ Local API (localhost:9000) ]"
if curl -sf http://localhost:9000/api/v1/health/ > /dev/null 2>&1; then
  ok "FastAPI is running"
else
  warn "FastAPI not running locally (normal if checking production only)"
fi

# ── EC2 API ────────────────────────────────────────────────────────────────────
if [ -n "$EC2_HOST" ]; then
  echo ""
  echo "[ EC2 API ($EC2_HOST) ]"
  HTTP=$(curl -sf -o /dev/null -w "%{http_code}" "http://$EC2_HOST/api/v1/health/" 2>/dev/null || echo "000")
  if [ "$HTTP" = "200" ]; then
    ok "API Gateway → EC2 → FastAPI: HTTP $HTTP"
  else
    fail "API not reachable at http://$EC2_HOST/api/v1/health/ (HTTP $HTTP)"
  fi

  SSH_KEY="${2:-$HOME/.ssh/nse-key.pem}"
  echo ""
  echo "[ EC2 systemd services ]"
  for svc in nse-api nse-worker; do
    STATE=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ubuntu@"$EC2_HOST" \
      "systemctl is-active $svc 2>/dev/null" 2>/dev/null || echo "unknown")
    if [ "$STATE" = "active" ]; then
      ok "$svc: $STATE"
    else
      fail "$svc: $STATE (run: make logs to diagnose)"
    fi
  done
fi

# ── AWS services ───────────────────────────────────────────────────────────────
echo ""
echo "[ AWS Services ($REGION) ]"

# DynamoDB tables
for table in users scraping_jobs scraping_tasks stock_transactions stock_watchlist product_data screener_cache menus menu_access email_messages email_sync_state product_master word_suggestions; do
  STATUS=$(aws dynamodb describe-table \
    --table-name "$table" \
    --region "$REGION" \
    --query "Table.TableStatus" \
    --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$STATUS" = "ACTIVE" ]; then
    ok "DynamoDB $table: ACTIVE"
  else
    fail "DynamoDB $table: $STATUS"
  fi
done

# S3 buckets
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
if [ -n "$ACCOUNT_ID" ]; then
  for bucket in "nse-frontend-$ACCOUNT_ID" "nse-assets-$ACCOUNT_ID"; do
    if aws s3 ls "s3://$bucket" > /dev/null 2>&1; then
      ok "S3 bucket $bucket: accessible"
    else
      fail "S3 bucket $bucket: not found or no access"
    fi
  done
fi

# API Gateway
API_ID=$(aws apigatewayv2 get-apis \
  --region "$REGION" \
  --query "Items[?Name=='nse-stock-api'].ApiId | [0]" \
  --output text 2>/dev/null || echo "None")
if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
  ok "API Gateway: $API_ID"
else
  warn "API Gateway 'nse-stock-api' not found (may not be deployed yet)"
fi

# Lambda functions
for fn in nse-screener-refresh nse-universe-refresh; do
  STATE=$(aws lambda get-function \
    --function-name "$fn" \
    --region "$REGION" \
    --query "Configuration.State" \
    --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$STATE" = "Active" ]; then
    ok "Lambda $fn: Active"
  else
    warn "Lambda $fn: $STATE (optional — deploy separately)"
  fi
done

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
if [ "$FAILED" -eq 0 ]; then
  echo "  ✓ All checks passed"
else
  echo "  ✗ Some checks failed — review output above"
fi
echo "══════════════════════════════════════════"
echo ""

exit $FAILED
