# Developer Guide — NSE Stock Dashboard (AWS Edition)

## Who is this for?
Anyone joining the project — new developer, contractor, or your future self.
Read this once before touching any code.

---

## Project layout (30-second map)

```
aws/
├── backend/app/           ← FastAPI application (runs on EC2)
│   ├── api/v1/endpoints/  ← HTTP layer ONLY — no business logic here
│   ├── services/          ← Business logic (stock data, scraping, sentiment)
│   ├── crud/              ← DynamoDB reads/writes — one file per table group
│   ├── schemas/           ← Pydantic request/response models
│   ├── core/              ← Security, roles, logging, exceptions
│   ├── db/dynamo.py       ← DynamoDB table objects (like SQLAlchemy engine)
│   ├── dependencies.py    ← FastAPI auth dependency (JWT → user dict)
│   ├── config.py          ← Settings from .env (AWS_REGION, SECRET_KEY, ...)
│   └── main.py            ← App factory, CORS, middleware, startup
│
├── frontend/              ← React SPA (hosted on S3)
│   └── src/utils/constants.js  ← API_URL + SSE_URL (read this first!)
│
├── infrastructure/
│   ├── scripts/           ← EC2 setup, deploy, nginx, systemd services
│   ├── dynamodb/          ← Table creation script (run once)
│   ├── iam/               ← IAM role + policy for EC2
│   ├── cloudwatch/        ← Log groups, alarms, dashboard
│   ├── eventbridge/       ← Scheduled rules (screener, universe refresh)
│   └── lambda/            ← Lightweight background jobs
│
├── docs/                  ← Architecture, setup guides, interview prep
├── Makefile               ← All developer commands (start here)
├── .github/workflows/     ← GitHub Actions CI/CD
└── .gitignore
```

---

## Local development (no AWS needed)

### One-time setup
```bash
# 1. Backend
cd aws/backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Copy and fill in the minimum required values
cp .env.example .env
# Edit .env: set SECRET_KEY to any random string, leave AWS vars blank for local use

# 2. Frontend
cd aws/frontend
npm install
```

### Run locally
```bash
# Terminal 1 — API (http://localhost:9000)
make local-backend

# Terminal 2 — React (http://localhost:3000)
make local-frontend
```

Open http://localhost:3000 in your browser.

**What works locally vs. AWS:**

| Feature | Local | AWS |
|---|---|---|
| Login / Users | ✓ (DynamoDB) | ✓ (DynamoDB) |
| Stock quotes / analysis | ✓ (yfinance) | ✓ (yfinance) |
| Playwright scraping | ✓ (if Playwright installed) | ✓ (EC2) |
| Avatar upload | ✗ (needs S3) | ✓ (S3) |
| Screener cache | ✓ (Lambda not needed) | ✓ (Lambda pre-computes) |

For local use you need AWS credentials configured (`aws configure`) because
the app reads DynamoDB even locally. The free tier covers local dev usage.

---

## How the layers talk to each other

```
Browser (React)
    │
    ├── REST calls ──────────────────→ API Gateway → EC2 Nginx → FastAPI
    │   (login, stock data,                              │
    │    portfolio, watchlist)                           ▼
    │                                              DynamoDB
    │
    └── SSE streams ─────────────────→ EC2 Nginx (direct, bypasses API Gateway)
        (scraping job progress)         │
                                        ▼
                                  FastAPI SSE generator (polls DynamoDB)
```

**Why two URLs?**
API Gateway has a hard **29-second timeout**. Scraping jobs run for minutes.
SSE streams go directly to EC2 to bypass this limit.

In the React code, set in `frontend/.env`:
- `REACT_APP_API_URL` → API Gateway URL (for all REST calls)
- `REACT_APP_SSE_URL` → EC2 public IP (for `/scraping/events` only)

---

## Adding a new feature

### Backend: new endpoint
```
1. Create  backend/app/api/v1/endpoints/your_feature.py
2. Create  backend/app/schemas/your_feature.py        (Pydantic models)
3. Create  backend/app/crud/your_feature_dynamo.py    (DynamoDB CRUD)
4. Register in  backend/app/api/v1/router.py:
       api_router.include_router(your_feature.router, prefix="/your-feature", tags=["YourFeature"])
5. If new DynamoDB table needed: add to  infrastructure/dynamodb/create_tables.py
```

### Frontend: new page
```
1. Add route in  frontend/src/App.js
2. Create page component in  frontend/src/pages/
3. Add API call in  frontend/src/services/   (use API_URL or SSE_URL from constants.js)
```

### Rule: which layer owns what?
- `api/v1/endpoints/` — HTTP only. No business logic, no direct DynamoDB calls.
- `services/` — Business logic only. No HTTP concerns (no `Request`, no `Response`).
- `crud/` — DynamoDB only. One file per table group. No business logic.
- `schemas/` — Pydantic models only. No logic.

---

## Deploy to AWS

### First deployment (one-time infrastructure)
```bash
# 1. Create all AWS resources
make setup-infra        # IAM, S3, DynamoDB, API Gateway, EventBridge

# 2. Launch EC2 t2.micro (see docs/02_STEP_BY_STEP_SETUP.md Phase 4)
#    Then run the EC2 setup script ON the instance:
bash infrastructure/scripts/ec2_setup.sh

# 3. Save EC2 IP for future deployments
echo "13.233.x.x" > aws/.ec2-host

# 4. First code push
make deploy             # pushes backend code + starts services
make deploy-frontend    # builds React + uploads to S3
```

### Routine deployment (code changes)
```bash
git add .
git commit -m "feat: your feature description"
git push origin main
# GitHub Actions automatically deploys both backend and frontend
```

Or deploy manually without git push:
```bash
make deploy             # backend only
make deploy-frontend    # frontend only
make deploy-all         # both
```

---

## Access from browser

### Local dev
```
React:   http://localhost:3000
API:     http://localhost:9000/docs   (Swagger UI)
```

### After AWS deployment
```
React:   http://nse-frontend-<account>.s3-website.ap-south-1.amazonaws.com
API docs: http://<ec2-ip>/docs
```

**Finding your URLs after deployment:**
1. S3 URL: AWS Console → S3 → `nse-frontend-<account>` → Properties → Static website hosting → Bucket website endpoint
2. API Gateway URL: AWS Console → API Gateway → `nse-stock-api` → Stages → prod → Invoke URL
3. EC2 IP: AWS Console → EC2 → Instances → your instance → Public IPv4 address

---

## Operations commands

```bash
make logs          # stream API logs (Ctrl+C to stop)
make logs-worker   # stream Playwright worker logs
make restart       # restart both services on EC2
make health        # run all health checks
make ssh           # open SSH shell to EC2
```

**View logs on AWS Console:**
- CloudWatch → Log groups → `/nse/api` → Log streams

---

## Continuous deployment with GitHub Actions

On every `git push origin main`:

1. **Backend job**: rsync → pip install → systemctl restart → health check
2. **Frontend job**: npm build (with prod env vars) → aws s3 sync

**Setup (one time):**
```
GitHub repo → Settings → Secrets and variables → Actions
Add these secrets:
  EC2_HOST               13.233.x.x
  EC2_SSH_KEY            (paste contents of nse-key.pem)
  AWS_ACCESS_KEY_ID      (IAM user with S3 access)
  AWS_SECRET_ACCESS_KEY
  REACT_APP_API_URL      https://xxx.execute-api.ap-south-1.amazonaws.com/prod/api/v1
  REACT_APP_SSE_URL      http://13.233.x.x
  S3_FRONTEND_BUCKET     nse-frontend-123456789012
```

**Check workflow status:**
GitHub repo → Actions tab → click the latest workflow run

---

## Debugging production issues

### API returning 500
```bash
make logs                    # see the error in real time
# or in AWS Console:
# CloudWatch → Log groups → /nse/api → search for ERROR
```

### Frontend not updating after deploy
```bash
# Force hard refresh in browser: Ctrl+Shift+R
# Or run: make deploy-frontend   (--delete flag removes stale S3 files)
```

### SSE stream disconnecting immediately
```bash
# Likely the frontend is using API_URL instead of SSE_URL for /scraping/events
# Check: frontend/src/services/scrapingService.js  — SSE calls must use SSE_URL
```

### DynamoDB errors (ThrottlingException)
```bash
# Free tier: 25 RCU + 25 WCU. Check CloudWatch alarm:
# CloudWatch → Alarms → NSE-DynamoDB-Throttles
# Fix: switch table to PAY_PER_REQUEST in create_tables.py and re-apply
```

### EC2 out of memory (t2.micro has 1 GB)
```bash
make ssh
free -h                       # check memory
sudo journalctl -u nse-worker --since "5 min ago"  # Playwright uses ~400 MB
# If OOM: reduce MAX_CONCURRENT in scraping_queue.py from 2 to 1
```

---

## Free tier checklist (stay $0/month)

| Service | Free limit | Our usage | Risk |
|---|---|---|---|
| EC2 t2.micro | 750 hr/month | ~730 hr | Safe |
| Elastic IP | Free when associated | 1 IP | **Unassociate = $0.005/hr** |
| S3 | 5 GB + 20k GET | Small SPA | Safe |
| DynamoDB | 25 GB + 25 RCU/WCU | Low traffic | Safe |
| API Gateway | 1M calls/month | Dev traffic | Safe |
| Lambda | 1M calls/month | 2 fns/day | Safe |
| CloudWatch | 5 GB logs/month | ~50 MB | Safe |

**Stop charges immediately:**
```bash
# Stop EC2 (keeps Elastic IP free):
aws ec2 stop-instances --instance-ids <id> --region ap-south-1

# WARNING: stopping EC2 while Elastic IP is still allocated = $0.005/hr charge
# Either keep EC2 running OR release the Elastic IP when stopping.
```
