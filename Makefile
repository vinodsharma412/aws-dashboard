# ══════════════════════════════════════════════════════════════════════════════
#  NSE Stock Dashboard — developer workflow commands
#
#  Quick start (local):
#    make local-backend     ← FastAPI on http://localhost:9000/docs
#    make local-frontend    ← React  on http://localhost:3000
#
#  Operations on AWS:
#    make logs              ← tail staging API logs  (STAGE=prod for prod)
#    make logs-worker       ← tail staging worker logs
#    make restart           ← restart staging services (STAGE=prod for prod)
#    make health            ← run health checks for both stages
#    make ssh               ← SSH shell to EC2
#    make test-staging      ← run automated API smoke tests against staging
#
#  Infrastructure (one-time per stage):
#    make dynamo-tables STAGE=staging
#    make dynamo-tables STAGE=prod
# ══════════════════════════════════════════════════════════════════════════════

# ── Config ────────────────────────────────────────────────────────────────────
STAGE    ?= staging
EC2_HOST ?= $(shell cat .ec2-host 2>/dev/null || echo "SET_EC2_HOST")
EC2_USER ?= ubuntu
SSH_KEY  ?= ~/.ssh/nse-key.pem
SSH      := ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no $(EC2_USER)@$(EC2_HOST)

# Remote dir: staging → /opt/nse-staging,  prod → /opt/nse
REMOTE_DIR := $(if $(filter prod,$(STAGE)),/opt/nse,/opt/nse-$(STAGE))

# Systemd service names
API_SVC    := $(if $(filter prod,$(STAGE)),nse-api,nse-api-$(STAGE))
WORKER_SVC := $(if $(filter prod,$(STAGE)),nse-worker,nse-worker-$(STAGE))

# Health check URL prefix
HEALTH_PREFIX := $(if $(filter prod,$(STAGE)),,/$(STAGE))

S3_BUCKET ?= $(shell grep S3_FRONTEND_BUCKET backend/.env 2>/dev/null | cut -d= -f2)

.PHONY: help local-backend local-frontend install-backend install-frontend \
        deploy deploy-frontend deploy-all logs logs-worker restart health ssh \
        test-staging dynamo-tables setup-infra lint

# ── Help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  NSE Stock Dashboard — developer commands"
	@echo ""
	@echo "  LOCAL DEVELOPMENT"
	@echo "    make install-backend    Install Python dependencies"
	@echo "    make install-frontend   Install Node dependencies"
	@echo "    make local-backend      FastAPI on http://localhost:9000/docs"
	@echo "    make local-frontend     React  on http://localhost:3000"
	@echo ""
	@echo "  OPERATIONS  (add STAGE=prod to target prod)"
	@echo "    make logs               Tail API logs from EC2"
	@echo "    make logs-worker        Tail worker logs from EC2"
	@echo "    make restart            Restart API + worker"
	@echo "    make health             Health check both stages"
	@echo "    make ssh                SSH shell to EC2"
	@echo "    make test-staging       Automated API smoke tests"
	@echo ""
	@echo "  INFRASTRUCTURE (one-time)"
	@echo "    make dynamo-tables STAGE=staging"
	@echo "    make dynamo-tables STAGE=prod"
	@echo ""

# ── Local development ─────────────────────────────────────────────────────────
install-backend:
	cd backend && pip install -r requirements.txt

install-frontend:
	cd frontend && npm install

local-backend:
	@echo "→ FastAPI on http://localhost:9000/docs  (STAGE=staging)"
	cd backend && STAGE=staging uvicorn app.main:app --reload --host 0.0.0.0 --port 9000

local-frontend:
	@echo "→ React on http://localhost:3000"
	cd frontend && npm start

# ── Deploy to AWS ─────────────────────────────────────────────────────────────
deploy:
	@echo "→ Deploying $(STAGE) backend to $(EC2_HOST):$(REMOTE_DIR)"
	rsync -az --delete \
		--exclude='__pycache__' --exclude='*.pyc' \
		--exclude='.env' --exclude='worker.pid' \
		-e "ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no" \
		backend/ $(EC2_USER)@$(EC2_HOST):$(REMOTE_DIR)/backend/
	$(SSH) "cd $(REMOTE_DIR) && source venv/bin/activate && \
		pip install -r backend/requirements.txt -q && \
		sudo systemctl restart $(API_SVC) $(WORKER_SVC)"
	@echo "✓ $(STAGE) deployed"

deploy-frontend:
	@echo "→ Building and uploading $(STAGE) frontend"
	@bash infrastructure/scripts/frontend_deploy.sh $(STAGE) $(S3_BUCKET)

deploy-all: deploy deploy-frontend

# ── Operations ────────────────────────────────────────────────────────────────
logs:
	@echo "→ $(API_SVC) logs (Ctrl+C to stop)"
	$(SSH) "sudo journalctl -u $(API_SVC) -f --no-hostname -o short-iso"

logs-worker:
	@echo "→ $(WORKER_SVC) logs (Ctrl+C to stop)"
	$(SSH) "sudo journalctl -u $(WORKER_SVC) -f --no-hostname -o short-iso"

restart:
	$(SSH) "sudo systemctl restart $(API_SVC) $(WORKER_SVC)"
	@echo "✓ $(STAGE) services restarted"

health:
	@echo "→ Staging health:"
	@curl -fsS "http://$(EC2_HOST)/staging/api/v1/health/" && echo " ✓ staging OK" || echo " ✗ staging FAIL"
	@echo "→ Prod health:"
	@curl -fsS "http://$(EC2_HOST)/api/v1/health/"         && echo " ✓ prod OK"    || echo " ✗ prod FAIL"

ssh:
	$(SSH)

test-staging:
	@echo "→ Running staging smoke tests..."
	@bash infrastructure/scripts/test_staging.sh $(EC2_HOST)

# ── Infrastructure (one-time per stage) ──────────────────────────────────────
dynamo-tables:
	@echo "→ Creating DynamoDB tables for STAGE=$(STAGE)"
	STAGE=$(STAGE) python3 infrastructure/dynamodb/create_tables.py

setup-infra:
	@echo "→ Full infra setup for STAGE=$(STAGE)"
	bash infrastructure/iam/setup_ec2_role.sh
	bash infrastructure/scripts/s3_setup.sh
	STAGE=$(STAGE) python3 infrastructure/dynamodb/create_tables.py
	bash infrastructure/ssm/setup_ssm.sh $(STAGE)
	bash infrastructure/sqs/setup_sqs.sh $(STAGE)
	bash infrastructure/sns/setup_sns.sh $(STAGE) $(EMAIL)

# ── Code quality ──────────────────────────────────────────────────────────────
lint:
	cd backend && python -m ruff check app/ --fix
