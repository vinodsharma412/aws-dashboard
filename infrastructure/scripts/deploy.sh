#!/bin/bash
# Deploy backend code to EC2 and restart the stage-specific systemd services.
#
# Usage:
#   bash infrastructure/scripts/deploy.sh <ec2-host> [ssh-key] [stage]
#   make deploy              ← STAGE=dev  (Makefile default)
#   make deploy STAGE=prod   ← production
#   make deploy STAGE=qc     ← QC
#
# Stage → remote directory → systemd services:
#   prod  →  /opt/nse       →  nse-api        nse-worker
#   dev   →  /opt/nse-dev   →  nse-api-dev    nse-worker-dev
#   qc    →  /opt/nse-qc    →  nse-api-qc     nse-worker-qc
#
# First-time EC2 setup: run infrastructure/scripts/ec2_setup.sh inside the instance.

set -euo pipefail

EC2_HOST="${1:?Usage: deploy.sh <ec2-host> [ssh-key] [stage]}"
SSH_KEY="${2:-$HOME/.ssh/nse-key.pem}"
STAGE="${3:-dev}"
EC2_USER="ubuntu"

# Derive paths from stage
if [ "$STAGE" = "prod" ]; then
  REMOTE_DIR="/opt/nse"
  SERVICE_API="nse-api"
  SERVICE_WORKER="nse-worker"
  HEALTH_PATH="/api/v1/health/"
else
  REMOTE_DIR="/opt/nse-${STAGE}"
  SERVICE_API="nse-api-${STAGE}"
  SERVICE_WORKER="nse-worker-${STAGE}"
  HEALTH_PATH="/${STAGE}/api/v1/health/"
fi

SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $EC2_USER@$EC2_HOST"

echo "══════════════════════════════════════════════════════"
echo "  Deploying to $EC2_HOST  [stage=$STAGE]"
echo "  Remote:   $REMOTE_DIR"
echo "  Services: $SERVICE_API  $SERVICE_WORKER"
echo "══════════════════════════════════════════════════════"

# ── 1. Sync backend code ───────────────────────────────────────────────────────
echo "[1/3] Syncing backend code..."
rsync -az --delete \
  --exclude "__pycache__" \
  --exclude "*.pyc" \
  --exclude ".env" \
  --exclude "venv/" \
  --exclude "worker.pid" \
  -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  backend/ \
  "$EC2_USER@$EC2_HOST:$REMOTE_DIR/backend/"

echo "      ✓ Code synced → $REMOTE_DIR/backend/"

# ── 2. Install/update Python dependencies ─────────────────────────────────────
echo "[2/3] Installing dependencies..."
$SSH "
  set -e
  cd $REMOTE_DIR
  # Create venv if it doesn't exist (first deploy)
  [ -d venv ] || python3 -m venv venv
  source venv/bin/activate
  pip install -r backend/requirements.txt -q
"
echo "      ✓ Dependencies up to date"

# ── 3. Restart services ────────────────────────────────────────────────────────
echo "[3/3] Restarting services..."
$SSH "
  # Restart worker first so it drains the SQS queue gracefully before API restarts
  sudo systemctl restart $SERVICE_WORKER || true
  sleep 2
  sudo systemctl restart $SERVICE_API
"
sleep 3

# Health check via Nginx (or direct port on fallback)
HTTP_STATUS=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://localhost${HEALTH_PATH}" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
  echo "      ✓ API is healthy (HTTP $HTTP_STATUS)"
else
  # Fallback: try direct uvicorn port
  PORT="9000"
  [ "$STAGE" = "dev" ] && PORT="9001"
  [ "$STAGE" = "qc"  ] && PORT="9002"
  HTTP_STATUS=$($SSH "curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT}/api/v1/health/" 2>/dev/null || echo "000")
  if [ "$HTTP_STATUS" = "200" ]; then
    echo "      ✓ API is healthy on port $PORT (HTTP $HTTP_STATUS)"
  else
    echo "      ✗ Health check failed (HTTP $HTTP_STATUS)"
    echo "        Logs: make logs STAGE=$STAGE"
    exit 1
  fi
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✓ Deployment complete!  [stage=$STAGE]"
echo ""
if [ "$STAGE" = "prod" ]; then
  echo "  API:   http://$EC2_HOST/api/v1"
  echo "  Docs:  http://$EC2_HOST/docs"
else
  echo "  API:   http://$EC2_HOST/${STAGE}/api/v1"
  echo "  Docs:  http://$EC2_HOST/${STAGE}/docs"
fi
echo "  Logs:  make logs STAGE=$STAGE"
echo "══════════════════════════════════════════════════════"
