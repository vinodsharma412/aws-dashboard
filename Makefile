# ══════════════════════════════════════════════════════════════════════════════
#  NSE Stock Dashboard — AWS edition
#  Developer workflow commands
#
#  Prerequisites:
#    - Copy .env.example to backend/.env and fill in values
#    - Set EC2_HOST in your shell or here:   export EC2_HOST=13.233.x.x
#    - SSH key must be in ~/.ssh/nse-key.pem  (or set SSH_KEY below)
#
#  Quick start (local):
#    make local-backend     ← FastAPI on :9000
#    make local-frontend    ← React on :3000
#
#  Deploy to AWS:
#    make deploy            ← push backend code to EC2 + restart services
#    make deploy-frontend   ← build React + upload to S3
#    make deploy-all        ← both at once
#
#  Operations:
#    make logs              ← tail API logs from EC2
#    make restart           ← restart systemd services on EC2
#    make health            ← run health checks (local + AWS)
#    make ssh               ← open SSH shell to EC2
# ══════════════════════════════════════════════════════════════════════════════

# ── Config (override via environment variables) ────────────────────────────────
STAGE        ?= dev
EC2_HOST     ?= $(shell cat .ec2-host 2>/dev/null || echo "SET_EC2_HOST")
EC2_USER     ?= ubuntu
SSH_KEY      ?= ~/.ssh/nse-key.pem
SSH          := ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no $(EC2_USER)@$(EC2_HOST)
# Remote dir is stage-specific so dev/qc/prod can coexist on the same EC2
REMOTE_DIR   := $(if $(filter prod,$(STAGE)),/opt/nse,/opt/nse-$(STAGE))

S3_FRONTEND  ?= $(shell grep S3_FRONTEND_BUCKET backend/.env 2>/dev/null | cut -d= -f2)
API_GW_URL   ?= $(shell grep REACT_APP_API_URL frontend/.env 2>/dev/null | cut -d= -f2)

.PHONY: help local-backend local-frontend install-backend install-frontend \
        deploy deploy-frontend deploy-all logs logs-worker restart health ssh \
        dynamo-tables setup-infra setup-stage sqs sns ssm cloudfront cloudwatch cloudtrail lint

# ── Help ───────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  NSE Stock Dashboard — developer commands"
	@echo ""
	@echo "  LOCAL DEVELOPMENT"
	@echo "    make install-backend    Install Python dependencies"
	@echo "    make install-frontend   Install Node dependencies"
	@echo "    make local-backend      Run FastAPI on http://localhost:9000"
	@echo "    make local-frontend     Run React on http://localhost:3000"
	@echo ""
	@echo "  DEPLOY TO AWS"
	@echo "    make deploy             Push backend to EC2 + restart"
	@echo "    make deploy-frontend    Build React + upload to S3"
	@echo "    make deploy-all         Both backend + frontend"
	@echo ""
	@echo "  OPERATIONS"
	@echo "    make logs               Tail API logs from EC2 (Ctrl+C to stop)"
	@echo "    make logs-worker        Tail Playwright worker logs from EC2"
	@echo "    make restart            Restart API + worker on EC2"
	@echo "    make health             Run health checks"
	@echo "    make ssh                Open SSH shell to EC2"
	@echo ""
	@echo "  INFRASTRUCTURE (run once)"
	@echo "    make dynamo-tables      Create DynamoDB tables"
	@echo "    make setup-infra        Run all setup scripts"
	@echo ""


# ── Local development ──────────────────────────────────────────────────────────

install-backend:
	cd backend && pip install -r requirements.txt

install-frontend:
	cd frontend && npm install

local-backend:
	@echo "→ Starting FastAPI on http://localhost:9000"
	cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 9000

local-frontend:
	@echo "→ Starting React on http://localhost:3000"
	cd frontend && npm start


# ── Deploy to AWS ──────────────────────────────────────────────────────────────

deploy:
	@bash infrastructure/scripts/deploy.sh $(EC2_HOST) $(SSH_KEY) $(STAGE)

deploy-frontend:
	@bash infrastructure/scripts/frontend_deploy.sh

deploy-all: deploy deploy-frontend
	@echo "✓ Full deployment complete"


# ── Operations ─────────────────────────────────────────────────────────────────

logs:
	@echo "→ Streaming API logs from $(EC2_HOST) (Ctrl+C to stop)"
	$(SSH) "sudo journalctl -u nse-api -f --no-hostname -o short-iso"

logs-worker:
	@echo "→ Streaming worker logs from $(EC2_HOST) (Ctrl+C to stop)"
	$(SSH) "sudo journalctl -u nse-worker -f --no-hostname -o short-iso"

restart:
	@echo "→ Restarting nse-api and nse-worker on $(EC2_HOST)"
	$(SSH) "sudo systemctl restart nse-api nse-worker"
	@echo "✓ Services restarted"

health:
	@bash infrastructure/scripts/health_check.sh $(EC2_HOST)

ssh:
	$(SSH)


# ── Infrastructure (one-time setup) ───────────────────────────────────────────

dynamo-tables:
	@echo "→ Creating DynamoDB tables for stage=$(STAGE)..."
	STAGE=$(STAGE) python infrastructure/dynamodb/create_tables.py

setup-infra:
	@echo "→ Setting up infrastructure for stage=$(STAGE)..."
	@echo "→ Step 1/5: IAM role..."
	bash infrastructure/iam/setup_ec2_role.sh
	@echo "→ Step 2/5: S3 buckets..."
	bash infrastructure/scripts/s3_setup.sh
	@echo "→ Step 3/5: DynamoDB tables..."
	STAGE=$(STAGE) python infrastructure/dynamodb/create_tables.py
	@echo "→ Step 4/5: API Gateway..."
	bash infrastructure/scripts/api_gateway_setup.sh
	@echo "→ Step 5/5: EventBridge rules..."
	bash infrastructure/eventbridge/setup_eventbridge.sh $(STAGE)
	@echo ""
	@echo "✓ Infrastructure setup complete for stage=$(STAGE)."
	@echo "  Next: provision EC2 and run  make deploy STAGE=$(STAGE)  to push code."


# ── Code quality ───────────────────────────────────────────────────────────────

lint:
	cd backend && python -m ruff check app/ --fix
