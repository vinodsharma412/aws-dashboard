# Developer Guide — NSE Stock Dashboard

> **New to this project? Read this first.** It covers everything you need to understand the codebase, run it locally, make changes, and deploy.

---

## Table of Contents
1. [Project layout](#1-project-layout)
2. [How the system works](#2-how-the-system-works)
3. [Run locally](#3-run-locally)
4. [Making code changes](#4-making-code-changes)
5. [Git workflow & CI/CD pipeline](#5-git-workflow--cicd-pipeline)
6. [Environments (dev / qc / prod)](#6-environments-dev--qc--prod)
7. [Operations & debugging](#7-operations--debugging)
8. [AWS services quick reference](#8-aws-services-quick-reference)

---

## 1. Project layout

```
aws/
├── backend/                     ← Python FastAPI (runs on EC2)
│   ├── app/
│   │   ├── api/v1/endpoints/    ← HTTP routes (auth, stocks, scraping, users…)
│   │   ├── services/            ← Business logic (stock analysis, sentiment…)
│   │   ├── crud/                ← DynamoDB read/write — one file per table group
│   │   ├── schemas/             ← Pydantic request/response models
│   │   ├── core/                ← Security (JWT), roles, logging, exceptions
│   │   ├── db/dynamo.py         ← DynamoDB table references
│   │   ├── config.py            ← All settings (reads .env + SSM at startup)
│   │   ├── dependencies.py      ← FastAPI auth dependency injection
│   │   ├── main.py              ← App factory — CORS, middleware, startup
│   │   └── worker.py            ← Playwright scraping worker (separate process)
│   └── requirements.txt
│
├── frontend/                    ← React SPA (deployed to S3)
│   └── src/
│       ├── pages/               ← One folder per page (Login, Dashboard…)
│       ├── components/          ← Reusable UI components
│       ├── services/            ← API calls (authService, stockService…)
│       ├── context/             ← React context (auth state)
│       └── assets/styles/       ← Global CSS
│
├── infrastructure/
│   ├── scripts/                 ← ec2_setup.sh, deploy.sh, nginx.conf, *.service
│   ├── dynamodb/create_tables.py← Creates all DynamoDB tables
│   ├── ssm/setup_ssm.sh         ← Stores secrets in SSM Parameter Store
│   ├── sqs/setup_sqs.sh         ← Creates SQS scraping job queues
│   ├── sns/setup_sns.sh         ← Creates SNS alert topic
│   ├── iam/                     ← IAM roles for EC2 and Lambda
│   ├── lambda/                  ← Lambda functions (screener, universe, dlq-alert)
│   ├── eventbridge/             ← Cron schedules for Lambda
│   ├── cloudfront/              ← CDN distribution setup
│   └── cloudwatch/              ← Alarms and dashboard
│
├── .github/workflows/deploy.yml ← CI/CD pipeline (DEV → QC → PROD)
├── Makefile                     ← Developer shortcuts
├── ruff.toml                    ← Python lint config
└── docs/                        ← Architecture, setup guides, this file
```

---

## 2. How the system works

### Request flow

```
User browser
    │
    ├─ REST API calls ──────────────────────────────────────────────────────────
    │   GET /dev/api/v1/stocks/RELIANCE                                        │
    │                          │                                                │
    │                    Nginx (EC2)                                            │
    │                    /dev/* → port 9001 (FastAPI dev)                      │
    │                    /qc/*  → port 9002 (FastAPI qc)                       │
    │                    /*     → port 9000 (FastAPI prod)                     │
    │                          │                                                │
    │                    FastAPI ──→ DynamoDB (read cache)                     │
    │                            ──→ yfinance (live prices)                    │
    │                            ──→ SQS (queue scraping job)                  │
    │                                                                           │
    └─ S3 (static frontend files)                                               │
        index.html, JS, CSS                                                     │

Background worker (separate process, same EC2):
    SQS queue ──→ worker.py ──→ Playwright scrapes NSE website ──→ DynamoDB
```

### Three stages on one EC2

| Stage | Port | Directory | Systemd service |
|-------|------|-----------|-----------------|
| prod  | 9000 | /opt/nse  | nse-api, nse-worker |
| dev   | 9001 | /opt/nse-dev | nse-api-dev, nse-worker-dev |
| qc    | 9002 | /opt/nse-qc  | nse-api-qc, nse-worker-qc |

### Config & secrets flow

```
Startup order:
1. Systemd sets STAGE=dev (via EnvironmentFile)
2. config.py reads .env file (fallback values)
3. config.py calls SSM Parameter Store to load secrets
   (JWT key, passwords, SQS URL, SNS ARN, etc.)
4. All settings available via: from app.config import settings
```

---

## 3. Run locally

### One-time setup
```bash
# Clone and enter project
git clone https://github.com/vinodsharma412/aws-dashboard.git
cd aws-dashboard

# Backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env — minimum required: SECRET_KEY=any-random-string

# Frontend
cd ../frontend
npm install
```

### Start the app (two terminals)
```bash
# Terminal 1 — Backend API on http://localhost:9000
make local-backend

# Terminal 2 — React on http://localhost:3000
make local-frontend
```

Open `http://localhost:3000` → login → explore.

API docs (Swagger): `http://localhost:9000/docs`

### What works locally vs AWS

| Feature | Local | AWS |
|---------|-------|-----|
| Login / JWT auth | ✓ | ✓ |
| Stock quotes & analysis | ✓ (yfinance) | ✓ |
| Portfolio / Watchlist | ✓ (DynamoDB) | ✓ |
| Playwright scraping | ✓ (if installed) | ✓ |
| File/avatar upload | ✗ needs S3 | ✓ |
| Screener cache | ✓ (computes live) | ✓ (Lambda pre-computes) |

> **Note:** Local development still uses DynamoDB. Run `aws configure` with your IAM credentials first.

---

## 4. Making code changes

### Adding a backend API endpoint

```
1. Create  backend/app/api/v1/endpoints/your_feature.py
   (copy an existing endpoint as a template — e.g. health.py for simple, stocks.py for complex)

2. Create  backend/app/schemas/your_feature.py
   (Pydantic models for request/response)

3. Create  backend/app/crud/your_feature_dynamo.py
   (DynamoDB reads/writes — use existing crud files as reference)

4. Register the router in  backend/app/api/v1/router.py:
   from app.api.v1.endpoints import your_feature
   api_router.include_router(your_feature.router, prefix="/your-feature", tags=["YourFeature"])

5. If you need a new DynamoDB table — add it to  infrastructure/dynamodb/create_tables.py
   then run: STAGE=dev python3 infrastructure/dynamodb/create_tables.py
```

**Layer rules (don't mix these up):**
- `endpoints/` — HTTP only. Validate input, call service, return response. No DynamoDB calls.
- `services/` — Business logic. No HTTP objects (`Request`/`Response`), no direct DynamoDB.
- `crud/` — DynamoDB only. One file per table group. No logic.
- `schemas/` — Pydantic models only. No methods.

### Adding a frontend page

```
1. Create  frontend/src/pages/YourPage/index.jsx
2. Add route in  frontend/src/App.js (or App.jsx)
3. Add API calls in  frontend/src/services/yourService.js
   (all API calls use REACT_APP_API_URL from environment)
4. Add navigation link if needed (sidebar/menu component)
```

### Lint before pushing
```bash
# Python
ruff check backend/app/

# Frontend build test
cd frontend && npm run build
```

---

## 5. Git workflow & CI/CD pipeline

### Branch strategy

```
main        ← production code only (protected)
develop     ← active development — all PRs merge here
release/**  ← optional: used for QC-specific fixes
```

### What happens when you push code

```
git push origin develop
        │
        ▼
┌─────────────────┐
│  Lint & Test    │  ruff check + npm build
│  (2 min)        │
└────────┬────────┘
         │ PASS
         ▼
┌─────────────────┐
│  Deploy DEV     │  rsync → pip install → systemctl restart → health check
│  (2 min)        │  URL: http://65.2.103.124/dev/api/v1/health/
└────────┬────────┘
         │ PASS (health check returns 200)
         ▼
┌─────────────────┐
│  Deploy QC      │  same process on /opt/nse-qc, port 9002
│  (2 min)        │  URL: http://65.2.103.124/qc/api/v1/health/
└────────┬────────┘
         │ PASS
         ▼
┌─────────────────┐
│  ⏳ Waiting...  │  GitHub sends email to reviewer
│  Approval gate  │  Reviewer clicks Approve in GitHub UI
└────────┬────────┘
         │ APPROVED
         ▼
┌─────────────────┐
│  Deploy PROD    │  same process on /opt/nse, port 9000
│  (2 min)        │  URL: http://65.2.103.124/api/v1/health/
└─────────────────┘
```

**If any step FAILS** — all later stages are skipped automatically.
**To approve PROD**: GitHub → Actions → latest run → "Review deployments" → Approve.

### Monitor pipeline
GitHub → `aws-dashboard` repo → **Actions** tab → click latest "Deploy Pipeline" run.

---

## 6. Environments (dev / qc / prod)

| | DEV | QC | PROD |
|-|-----|----|------|
| **Purpose** | Daily development | Pre-release testing | Live users |
| **Trigger** | Auto on `develop` push | Auto after DEV passes | Manual approval |
| **Backend URL** | `http://65.2.103.124/dev/api/v1` | `http://65.2.103.124/qc/api/v1` | `http://65.2.103.124/api/v1` |
| **API Docs** | `http://65.2.103.124/dev/docs` | `http://65.2.103.124/qc/docs` | `http://65.2.103.124/docs` |
| **Frontend** | S3 `/dev/` folder | S3 `/qc/` folder | S3 root `/` |
| **DynamoDB prefix** | `dev_` | `qc_` | _(none)_ |
| **SQS queue** | `nse-scraping-jobs-dev` | `nse-scraping-jobs-qc` | `nse-scraping-jobs` |

### Secrets (GitHub → Settings → Secrets → Actions)

| Secret | Value |
|--------|-------|
| `EC2_HOST` | EC2 public IP |
| `EC2_SSH_KEY` | Contents of `.pem` key file |
| `AWS_ACCESS_KEY_ID` | IAM user key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret |
| `S3_FRONTEND_BUCKET` | `nse-frontend-<account-id>` |
| `DEV_API_URL` | `http://<ec2-ip>/dev/api/v1` |
| `DEV_SSE_URL` | `http://<ec2-ip>` |
| `QC_API_URL` | `http://<ec2-ip>/qc/api/v1` |
| `QC_SSE_URL` | `http://<ec2-ip>` |

---

## 7. Operations & debugging

### Useful make commands
```bash
make logs              # tail DEV API logs live (Ctrl+C to stop)
make logs STAGE=prod   # tail PROD logs
make restart           # restart all services on EC2
make health            # run health checks for all stages
make ssh               # open SSH shell to EC2
```

### Check service status on EC2
```bash
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<ec2-ip>

sudo systemctl status nse-api-dev    # is it running?
sudo journalctl -u nse-api-dev -f    # live logs
sudo journalctl -u nse-api-dev -n 50 --no-pager  # last 50 lines
```

### Common problems & fixes

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| 502 Bad Gateway | Service not running | `sudo systemctl restart nse-api-dev` |
| Service crashes on start | Missing .env or wrong package | `journalctl -u nse-api-dev -n 30` to see error |
| CI SSH fails (exit 255) | EC2 security group blocks GitHub IPs | Allow SSH 0.0.0.0/0 in security group |
| Health check timeout | App takes >40s to start | Already set to 40s sleep; check DynamoDB connectivity |
| `No space left on device` | EC2 disk full (pip cache, venvs) | `rm -rf ~/.cache/pip /tmp/pip-*` |
| Frontend not updating | S3 cache | Hard refresh: Ctrl+Shift+R |
| DynamoDB ResourceNotFound | Tables not created for stage | `STAGE=dev python3 infrastructure/dynamodb/create_tables.py` |

### View logs in AWS Console
- CloudWatch → Log groups → `/nse/api` → Log streams → latest

---

## 8. AWS services quick reference

| Service | What it does in this project |
|---------|------------------------------|
| EC2 | Runs FastAPI + Playwright worker (all 3 stages) |
| S3 | Hosts React frontend + user avatar uploads |
| DynamoDB | Main database (users, stocks, watchlists, screener cache) |
| SQS | Queue for scraping jobs — decouples API from worker |
| SNS | Email alerts when scraping jobs fail |
| SSM Parameter Store | Stores secrets (JWT key, passwords, queue URLs) |
| Lambda | Pre-computes screener cache (every 30min) + DLQ alert |
| EventBridge | Cron triggers for Lambda functions |
| CloudFront | CDN for S3 frontend (HTTPS, fast delivery) |
| CloudWatch | Alarms + dashboard for EC2, DynamoDB, SQS |
| CloudTrail | Audit log of all AWS API calls |
| IAM | EC2 instance role — no hardcoded AWS keys on server |
| Comprehend | ML sentiment analysis on stock news |
