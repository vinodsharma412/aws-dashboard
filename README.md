# Stock Dashboard — AWS Solutions Architect Professional

A production-grade full-stack application demonstrating **AWS Solutions Architect Professional** patterns using **only free-tier AWS services**.

React frontend · FastAPI backend · DynamoDB · SQS · SNS · Lambda · EventBridge · CloudFront · SSM · Comprehend · CloudWatch · CloudTrail

---

## What this application does

| Feature | Description |
|---------|-------------|
| **Login / RBAC** | JWT-based auth. Roles: Admin, Manager, Viewer. Menu access control per role |
| **Stock Search** | Search NSE equity symbols (RELIANCE, TCS, INFY, etc.) |
| **Stock Analysis** | RSI, MACD, Bollinger Bands, SMA 50/200, Buy/Sell/Hold signal |
| **News Sentiment** | Bing/Google RSS + **Amazon Comprehend** ML scoring → Bullish/Bearish/Neutral |
| **Stock Screener** | Filter by dividend yield, P/E, composite score (cached by Lambda every 30 min) |
| **Portfolio Tracker** | Record buys/sells, live P&L, AI-style holding recommendations |
| **Amazon Scraper** | Enter ASINs → Playwright scrapes title, price, rating from Amazon.in |
| **Live Job Tracker** | Real-time scraping progress via SSE (Server-Sent Events) |
| **User Management** | Admin CRUD for users, avatar upload to S3 |
| **Global Markets** | Nifty 50, Sensex, S&P 500, NASDAQ, Gold, USD/INR snapshot |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Internet                                    │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
    ┌──────▼──────┐       ┌────────▼────────┐
    │  CloudFront │       │  API Gateway    │
    │  (CDN/HTTPS)│       │  (REST/throttle)│
    └──────┬──────┘       └────────┬────────┘
           │                       │
    ┌──────▼──────┐       ┌────────▼────────┐
    │  S3 Bucket  │       │  EC2 t2.micro   │
    │  (React SPA)│       │  Nginx + FastAPI │
    │  (OAC only) │       │  port 9000      │
    └─────────────┘       └────────┬────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
    ┌─────────▼──────┐  ┌──────────▼────────┐  ┌───────▼────────┐
    │   DynamoDB     │  │  SQS Queue        │  │  SSM Param     │
    │  13 tables     │  │  scraping jobs    │  │  Store         │
    │  stage-prefix  │  │  + Dead Ltr Queue │  │  (secrets)     │
    └────────────────┘  └──────────┬────────┘  └────────────────┘
                                   │ Worker long-polls
                        ┌──────────▼────────┐
                        │  EC2 Worker       │
                        │  (Playwright)     │
                        └──────────┬────────┘
                             fail 3×│
                        ┌──────────▼────────┐
                        │  SQS DLQ          │──→ Lambda: nse-dlq-alert
                        └───────────────────┘         │
                                                       ▼
                                                  SNS: nse-alerts
                                                       │
CloudWatch Alarms ─────────────────────────────────────┘
(Lambda errors, DLQ depth, EC2 CPU/status, API GW 5XX)     │
                                                        Email ✉

Scheduled (EventBridge):
  3:00 AM IST daily   → Lambda: nse-universe-refresh  → DynamoDB
  Every 30 min market → Lambda: nse-screener-refresh  → DynamoDB cache

Sentiment scoring (news articles):
  RSS fetch → Amazon Comprehend batch_detect_sentiment (free ML)
            → fallback: keyword scoring (offline)

Audit:
  All API calls → CloudTrail → S3 bucket (encrypted, versioned)
```

---

## AWS Services — What, Why, Free Tier

| Service | Purpose in This Project | Free Tier |
|---------|------------------------|-----------|
| **EC2** t2.micro | FastAPI + Nginx + Playwright worker | 750 hrs/month (12 mo) |
| **DynamoDB** | Primary database — 13 stage-isolated tables | 25 GB + 200M req forever |
| **S3** | React frontend + user avatar storage | 5 GB + 20k GET (12 mo) |
| **Lambda** | Screener refresh + Universe refresh + DLQ alert | 1M req + 400k GB-s forever |
| **API Gateway** | HTTPS REST proxy to EC2 — throttling, CORS | 1M calls/month (12 mo) |
| **CloudFront** | CDN for React SPA — HTTPS, edge caching, OAC | 1 TB + 10M req (12 mo) |
| **SQS** | Scraping job queue + DLQ for failed jobs | 1M req/month forever |
| **SNS** | Email alerts: failures, EC2 down, Lambda errors | 1M publishes/month forever |
| **EventBridge** | Cron schedules for Lambda functions | Free |
| **SSM Parameter Store** | SecureString secrets — **free** alt. to Secrets Manager | Free (AWS-managed key) |
| **Amazon Comprehend** | ML sentiment scoring on news articles | 50k units/month (12 mo) |
| **CloudWatch** | Alarms + dashboard for Lambda/SQS/EC2/API GW | 10 alarms free |
| **CloudTrail** | API audit log → S3 (who did what, when) | 1 trail free |
| **IAM** | EC2 instance profile + Lambda role (no hardcoded keys) | Free |

> **Why SSM over Secrets Manager?**
> Secrets Manager costs $0.40/secret/month. SSM SecureString with the AWS-managed key costs nothing. For this project they provide equivalent security.

> **Why Comprehend over local LLM?**
> Ollama on a t2.micro consumed too much CPU. Comprehend is a managed NLP service — 500-char article = 5 units; 1,000 articles/month = 5,000 units — well under the 50,000 free tier limit.

---

## Three-Stage Deployment

Same codebase, three isolated environments in the **same AWS account**.

| Stage | Git branch | DynamoDB tables | SSM path | Deploy |
|-------|-----------|-----------------|----------|--------|
| `dev` | `develop` | `dev_users`, `dev_menus`… | `/nse/dev/` | Auto on push |
| `qc` | `release/**` | `qc_users`, `qc_menus`… | `/nse/qc/` | Auto on push |
| `prod` | `main` | `users`, `menus`… | `/nse/prod/` | Manual approval |

### Git workflow
```
feature/xyz ─┐
             ├──→  develop  ──→  release/1.2.0  ──→  main
             │        ↓               ↓               ↓
             │       DEV             QC             PROD
             │   (auto-deploy)   (auto-deploy)  (+approval gate)
```

### How stage isolation works

The `STAGE` environment variable controls everything:

```python
# app/config.py
@property
def table_prefix(self) -> str:
    return "" if self.STAGE == "prod" else f"{self.STAGE}_"

# app/db/dynamo.py
dynamo_users = _table("users")   # → "users" in prod, "dev_users" in dev
```

All SQS queues, SSM parameters, Lambda functions, and CloudWatch alarms also
include the stage name, so environments never interfere.

---

## How the System Works — Data Flows

### User request (read)
```
1. User opens browser
2. CloudFront (edge node) → S3 → React SPA (HTML/JS/CSS)
3. React → API Gateway (HTTPS) → EC2 Nginx → FastAPI
4. FastAPI verifies JWT, queries DynamoDB, returns JSON
5. React renders data
```

### Scraping job (write + async)
```
1. POST /api/v1/scraping/jobs
   → FastAPI creates job record in DynamoDB (status: pending)
   → scraping_queue.enqueue(task_id) sends to SQS

2. EC2 Worker (long-polls SQS, 20-second wait)
   → receives {"task_id": "uuid"}
   → fetches task from DynamoDB → runs Playwright scrape
   → SUCCESS: updates DynamoDB, deletes SQS message
   → FAILURE: does NOT delete → SQS retries after 300 s

3. After 3 failures:
   → SQS moves message to Dead Letter Queue
   → DLQ triggers Lambda nse-dlq-alert
   → Lambda reads task error from DynamoDB
   → Publishes email alert to SNS
   → Admin receives: ASIN + error + job ID

4. User sees live progress via SSE stream (direct EC2, bypasses API GW)
```

### Sentiment analysis (AI)
```
1. GET /api/v1/stocks/sentiment/TCS
2. Fetch news from Bing RSS → Google RSS fallback (free, no API key)
3. Enrich truncated summaries via og:description (parallel HTTP, cached 24h)
4. POST Comprehend batch_detect_sentiment(texts, LanguageCode="en")
   → returns POSITIVE/NEGATIVE/NEUTRAL/MIXED with confidence scores
   → score = SentimentScore.Positive - SentimentScore.Negative  (-1.0 to +1.0)
   → fallback to keyword scoring on ThrottlingException
5. Cache result 10 minutes
6. Return: score, label, confidence, headlines, scored_by
```

### Secrets resolution (SSM)
```
1. App starts → Settings() reads STAGE from env
2. For each empty field (SECRET_KEY, GMAIL_*, SQS_URL, SNS_ARN):
   → calls _ssm_get("/nse/{stage}/{key}")
   → EC2 instance profile authenticates automatically (no keys in code)
3. @lru_cache — SSM called exactly once per process lifetime
4. Local dev: if SSM fails → uses .env value → no breakage
```

---

## Local Development Setup

### Prerequisites
- Python 3.12+, Node.js 20+, AWS CLI, Git

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/nse-stock-dashboard.git
cd aws
cp backend/.env.example backend/.env
# Edit backend/.env: set SECRET_KEY, set COMPREHEND_ENABLED=false
pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
```

### 2. Start locally
```bash
make local-backend    # FastAPI on http://localhost:9000/docs
make local-frontend   # React  on http://localhost:3000
```

> **Local dev tip:** Set `COMPREHEND_ENABLED=false` and `SQS_SCRAPING_JOBS_URL=` (empty) in `.env`.
> The app falls back to keyword sentiment scoring and an in-memory job queue — no AWS resources needed.

---

## First-Time AWS Setup

### Option A — Master script (recommended, run once per stage)
```bash
bash infrastructure/scripts/setup_stage.sh dev  65.2.103.124 your@email.com
bash infrastructure/scripts/setup_stage.sh qc   65.2.103.124 your@email.com
bash infrastructure/scripts/setup_stage.sh prod 65.2.103.124 your@email.com
```

This runs all 9 phases: IAM → S3/DynamoDB → SSM secrets → SQS/SNS → Lambda → EventBridge → CloudFront → CloudWatch → CloudTrail.

### Option B — Step by step

```bash
# 1. IAM (once per account)
bash infrastructure/iam/setup_ec2_role.sh
bash infrastructure/iam/setup_lambda_role.sh

# 2. Storage
bash infrastructure/scripts/s3_setup.sh
STAGE=prod python3 infrastructure/dynamodb/create_tables.py

# 3. Secrets (interactive)
bash infrastructure/ssm/setup_ssm.sh prod

# 4. Messaging
bash infrastructure/sqs/setup_sqs.sh prod
bash infrastructure/sns/setup_sns.sh prod your@email.com
# ⚠ CONFIRM the subscription email before continuing!

# 5–9: Lambda, EventBridge, CloudFront, CloudWatch, CloudTrail
# (see setup_stage.sh for full sequence)
```

---

## Git-Based Deployment (GitHub Actions)

### Setup GitHub Secrets

**Settings → Secrets and variables → Actions:**

| Secret | Value |
|--------|-------|
| `EC2_HOST` | `65.2.103.124` |
| `EC2_SSH_KEY` | Contents of `~/.ssh/nse-key.pem` |
| `AWS_ACCESS_KEY_ID` | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `S3_FRONTEND_BUCKET` | `nse-frontend-961341540531` |
| `DEV_API_URL` | `http://65.2.103.124/api/v1` |
| `DEV_SSE_URL` | `http://65.2.103.124` |
| `PROD_API_URL` | `https://y04lj0toia.execute-api.ap-south-1.amazonaws.com/prod/api/v1` |
| `PROD_SSE_URL` | `http://65.2.103.124` |

### Setup approval gate for prod

**Settings → Environments → New environment → "prod" → Required reviewers: (add yourself)**

### Deploy by pushing

```bash
# Deploy to DEV automatically
git checkout develop && git push origin develop

# Deploy to QC automatically
git checkout -b release/1.2.0 && git push origin release/1.2.0

# Deploy to PROD (waits for your approval in GitHub)
git checkout main && git merge release/1.2.0 && git push origin main
```

---

## Infrastructure Reference

```
infrastructure/
├── iam/
│   ├── setup_ec2_role.sh       EC2 instance profile (DynamoDB + S3 + SSM access)
│   └── setup_lambda_role.sh    Lambda execution role (DynamoDB + SSM + SNS access)
├── ssm/
│   └── setup_ssm.sh            Store secrets in SSM (JWT key, SMTP, queue URLs)
├── sqs/
│   └── setup_sqs.sh            Create main queue + DLQ per stage
├── sns/
│   └── setup_sns.sh            Create alert topic + email subscription per stage
├── cloudfront/
│   └── setup_cloudfront.sh     CDN distribution with OAC + cache behaviours
├── cloudwatch/
│   ├── setup_alarms.sh         6 alarms + operations dashboard per stage
│   └── install_agent_on_ec2.sh CloudWatch agent for memory/disk metrics on EC2
├── cloudtrail/
│   └── setup_cloudtrail.sh     Audit trail → S3 (account-wide, run once)
├── eventbridge/
│   └── setup_eventbridge.sh    Cron rules for Lambda functions
├── dynamodb/
│   └── create_tables.py        Create DynamoDB tables for a given STAGE
├── lambda/
│   ├── screener_refresh/
│   │   └── handler.py          Pre-compute screener → DynamoDB cache (every 30 min)
│   ├── universe_refresh/
│   │   └── handler.py          Download NSE symbol list → DynamoDB (daily)
│   └── dlq_alert/
│       └── handler.py          DLQ trigger → SNS email alert (on scraper failure)
└── scripts/
    ├── setup_stage.sh          Master: all 9 phases for one stage
    ├── deploy.sh               Backend rsync to EC2
    ├── frontend_deploy.sh      React build + S3 upload
    ├── api_gateway_setup.sh    API Gateway HTTP API
    ├── s3_setup.sh             S3 buckets
    ├── health_check.sh         Verify all endpoints
    ├── nginx.conf              Nginx reverse proxy
    ├── nse-api.service         systemd: FastAPI
    └── nse-worker.service      systemd: SQS polling worker
```

---

## Configuration Reference

### SSM parameters per stage (`/nse/{stage}/`)

| Parameter | Type | How it's used |
|-----------|------|---------------|
| `jwt-secret` | SecureString | Signs/verifies all JWT tokens |
| `gmail-user` | String | SMTP sender for email alerts |
| `gmail-password` | SecureString | Gmail app password |
| `sqs-jobs-url` | String | SQS queue URL for scraping jobs |
| `sns-alerts-arn` | String | SNS topic for ops alerts |
| `s3-assets-bucket` | String | S3 bucket for user avatars |
| `cloudfront-dist-id` | String | Used by CI/CD for cache invalidation |
| `service-account-password` | SecureString | nse-service user (Lambda → EC2 auth) |

```bash
# View all params for a stage
aws ssm get-parameters-by-path --path /nse/prod/ --with-decryption --region ap-south-1
```

### CloudWatch alarms (per stage)

| Alarm | Metric | Threshold |
|-------|--------|-----------|
| `nse-sqs-dlq-depth-{stage}` | DLQ visible messages | > 0 |
| `nse-lambda-screener-errors-{stage}` | Lambda errors | > 0 in 5 min |
| `nse-lambda-universe-errors-{stage}` | Lambda errors | > 0 in 5 min |
| `nse-ec2-cpu-high-{stage}` | EC2 CPU% | > 80% for 10 min |
| `nse-ec2-status-failed-{stage}` | StatusCheckFailed | > 0 for 2 min |
| `nse-apigw-5xx-{stage}` | API GW 5XX count | > 10 in 5 min |

All alarms publish to SNS → email.

---

## Key Technical Decisions

**Why SSM over Secrets Manager?**
Secrets Manager = $0.40/secret/month × 8 secrets = $3.20/month. SSM SecureString with the AWS-managed key = $0. Both provide encrypted, auditable, rotatable secret storage.

**Why SQS over in-memory queue?**
In-memory queue loses all pending jobs on EC2 restart or deploy. SQS is durable — jobs survive restarts. The DLQ automatically catches permanently failing jobs after 3 attempts and triggers an email alert.

**Why Amazon Comprehend over Ollama?**
Ollama runs a local LLM that consumes 1–2 GB RAM on t2.micro, crowding out Playwright. Comprehend is fully managed, returns results in <1 second, and the free tier easily covers this project's load.

**Why CloudFront over direct S3 URL?**
S3 static website only serves HTTP. CloudFront provides HTTPS, edge caching, custom 404→index.html routing (required for React SPA), and Origin Access Control (blocks direct S3 access).

**Why EC2 for the scraping worker?**
Lambda has a 250 MB package limit. Playwright + Chromium is ~400 MB. EC2 runs the worker as a systemd service that polls SQS — it auto-restarts on crash and processes at most 2 concurrent scrapes.

---

## Troubleshooting

### Scraper not processing / stuck

```bash
make logs-worker                            # tail worker logs
aws sqs get-queue-attributes \
  --queue-url $SQS_URL \
  --attribute-names ApproximateNumberOfMessages
```

### Sentiment returns "keywords" (not "comprehend")

Check `COMPREHEND_ENABLED=true` in `.env`.
Verify EC2 role has `comprehend:BatchDetectSentiment` permission.
Check CloudWatch logs for ThrottlingException.

### No alert emails from DLQ

```bash
# 1. Check subscription confirmed
aws sns list-subscriptions-by-topic --topic-arn $SNS_ARN

# 2. Check Lambda event source mapping exists
aws lambda list-event-source-mappings --function-name nse-dlq-alert-prod

# 3. Manual test
aws lambda invoke --function-name nse-dlq-alert-prod \
  --payload '{"Records":[{"Body":"{\"task_id\":\"test\"}","attributes":{"ApproximateReceiveCount":"3"}}]}' \
  --cli-binary-format raw-in-base64-out /tmp/out.json && cat /tmp/out.json
```

### Secrets not loading (SSM)

```bash
# Verify parameters exist
aws ssm get-parameters-by-path --path /nse/prod/ --with-decryption

# Verify EC2 role has ssm:GetParameter
aws iam get-role-policy --role-name NSEStockDashboardEC2Role --policy-name NSEStockDashboardPolicy
```

---

## Cost

**Total: $0/month** for the first 12 months on the AWS Free Tier.

After 12 months the main cost is EC2 t2.micro (~$10/month in ap-south-1). All other services either remain free forever (DynamoDB, Lambda, SQS, SNS, EventBridge, SSM) or have minimal cost at this scale.

---

*Designed to demonstrate AWS Solutions Architect Professional patterns — multi-stage CI/CD, event-driven messaging, managed AI services, observability, audit logging, and CDN delivery — entirely within the AWS Free Tier.*
