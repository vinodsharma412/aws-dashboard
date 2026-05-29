# Complete AWS Solution Architecture — NSE Stock Dashboard

## Full System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BROWSER (React SPA)                                  │
│              http://nse-frontend-<id>.s3-website.ap-south-1.amazonaws.com   │
└─────────┬────────────────────────────────────────────┬───────────────────────┘
          │  REST API calls (JSON)                      │  SSE streams only
          │  Authorization: Bearer JWT                   │  (bypass API GW — 29s limit)
          ▼                                             ▼
┌──────────────────────────┐              ┌────────────────────────────────────┐
│   AWS API Gateway        │              │   EC2 Nginx :80 (direct)           │
│   HTTP API               │              │   /scraping/events                 │
│   ap-south-1             │              │   /scraping/jobs/{id}/events       │
│                          │              └──────────────┬─────────────────────┘
│   Stage: /prod           │                             │
│   Routes:                │                             │
│   ANY /{proxy+}          │                             │
│   → EC2 integration      │                             │
└───────────┬──────────────┘                             │
            │  HTTP proxy                                │
            │  (all REST routes)                         │
            ▼                                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     EC2 t2.micro  (ap-south-1 / Mumbai)                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Nginx  :80                                                          │   │
│  │   /api/*  →  FastAPI :9000                                           │   │
│  │   /static/* → FastAPI :9000 (S3 avatars redirect)                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  FastAPI (uvicorn :9000) — systemd: nse-api.service                  │   │
│  │   /api/v1/auth/*     — login → JWT                                   │   │
│  │   /api/v1/users/*    — CRUD users (DynamoDB)                         │   │
│  │   /api/v1/stocks/*   — yfinance analysis, portfolio, watchlist        │   │
│  │   /api/v1/scraping/* — job mgmt + SSE progress stream                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Playwright Worker — systemd: nse-worker.service                     │   │
│  │   polls DynamoDB (status-index GSI)                                  │   │
│  │   → scrape amazon.in → save ProductData to DynamoDB                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  IAM Instance Profile: NSEStockDashboardEC2Role                            │
│   (DynamoDB: all tables in account | S3: nse-assets-* bucket)              │
└─────────────┬───────────────────────────────┬───────────────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────┐    ┌──────────────────────────────────────────────┐
│  AWS DynamoDB           │    │  AWS S3                                       │
│  ap-south-1             │    │  ap-south-1                                   │
│                         │    │                                               │
│  Tables (no prefix —    │    │  nse-frontend-<account-id>  (static website) │
│  accounts are isolated):│    │   React build files (public read)            │
│  users                  │    │                                               │
│  stock_transactions     │    │  nse-assets-<account-id>  (private)          │
│  stock_watchlist        │    │   avatars/user_*.jpg                         │
│  scraping_jobs          │    │   (signed URL or public per object)          │
│  scraping_tasks         │    │                                               │
│  product_data           │    │                                               │
└─────────────────────────┘    └──────────────────────────────────────────────┘

NOTE: Staging and prod are separate AWS accounts (472353356905 and 019711414477).
Each account has its own EC2, DynamoDB, S3, SQS, and SNS — no shared infrastructure.
Table names are identical in both accounts (no prefix needed — isolation is at account level).

── Background automation (EventBridge + Lambda) ──────────────────────────────

┌─────────────────────────────────────────────────────────────────────────────┐
│  AWS EventBridge (event bus + scheduled rules)                              │
│                                                                             │
│  Rule 1: cron(0 3 * * ? *)  daily 3 AM IST                                 │
│   → Lambda: nse-universe-refresh                                            │
│     downloads NSE EQUITY_L.csv → stores 1800+ symbols in DynamoDB          │
│                                                                             │
│  Rule 2: cron(0/30 6-16 ? * MON-FRI *)  every 30 min, market hours         │
│   → Lambda: nse-screener-refresh                                            │
│     pre-computes top 40 screener stocks → DynamoDB cache table              │
│                                                                             │
│  Rule 3: ec2-state-change  (EC2 starts/stops)                               │
│   → Lambda: nse-health-notifier → SNS → email alert                        │
└─────────────────────────────────────────────────────────────────────────────┘

── Observability (CloudWatch) ────────────────────────────────────────────────

┌─────────────────────────────────────────────────────────────────────────────┐
│  AWS CloudWatch                                                             │
│                                                                             │
│  Log Groups:                                                                │
│   /nse/api          ← FastAPI uvicorn logs (via CloudWatch Agent on EC2)   │
│   /nse/worker       ← Playwright worker logs                                │
│   /aws/lambda/nse-* ← Lambda function logs (automatic)                     │
│   /aws/apigateway/nse-stock-api ← API Gateway access logs                  │
│                                                                             │
│  Metric Alarms:                                                             │
│   EC2 CPU > 80%    → SNS email "High CPU on nse server"                    │
│   EC2 Memory > 85% → SNS email (custom metric via CloudWatch Agent)        │
│   API 5xx > 10/min → SNS email "API errors spiking"                        │
│   Lambda errors    → SNS email                                              │
│                                                                             │
│  Dashboard: NSE-Stock-Dashboard                                             │
│   Widgets: API request rate, EC2 CPU, DynamoDB consumed RCU/WCU,            │
│            Lambda duration, S3 requests                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Service Roles — Why Each AWS Service

| Service | Role | Replaces |
|---|---|---|
| **S3 (frontend)** | Host React build (static website) | Local `npm start` |
| **API Gateway HTTP API** | Single public HTTPS endpoint, rate limiting, throttling | Direct EC2 exposure |
| **EC2 t2.micro** | Run FastAPI + Playwright (needs persistent process + SSE) | `uvicorn` on localhost |
| **DynamoDB** | Store users, portfolio, scraping data (serverless, no patching) | PostgreSQL |
| **S3 (assets)** | Store avatar images (cross-restart persistence) | Local `/static/avatars` |
| **Lambda** | Background jobs (screener refresh, universe download) | Cron jobs on EC2 |
| **EventBridge** | Trigger Lambdas on schedule (market hours) | `crontab` |
| **CloudWatch** | Logs, metrics, alarms, dashboard | `tail -f` / Grafana |
| **IAM** | Role-based access — EC2 never needs hard-coded credentials | `.env` AWS keys |

---

## Why API Gateway + EC2 (not Lambda for everything)

```
Route Type        API Gateway + Lambda?    API Gateway + EC2?
─────────────     ─────────────────────    ──────────────────
REST endpoints    ✅ Works great            ✅ Works great
SSE streaming     ❌ 29s timeout            ✅ nginx proxy_buffering off
Playwright        ❌ 250MB limit            ✅ installed on EC2
Worker polling    ❌ not event-driven       ✅ systemd service
Cost (free tier)  ✅ 1M req free            ✅ 750h/mo free
```

Decision: **API Gateway as the entry point** for all REST calls, routing to EC2.
SSE endpoints bypass API Gateway and hit EC2 Nginx directly on the same port.

---

## Data Flow — Stock Analysis Request

```
User clicks "Analyse TCS"
    ↓
React: GET /api/v1/stocks/analyse/TCS.NS
       Header: Authorization: Bearer eyJhbGci...
    ↓
API Gateway HTTP API
  - Validates route: GET /prod/api/v1/stocks/analyse/{proxy}
  - Forwards to EC2 integration URL with all headers
    ↓
EC2 Nginx :80 → FastAPI :9000
    ↓
dependencies.py: get_current_active_user()
  - decode_token(JWT) → username = "admin"
  - dynamo_users.query(username-index) → user dict
  - assert user.is_active == True
    ↓
stocks.py endpoint: analyse("TCS.NS")
  1. sentiment_service.analyze_sentiment("TCS.NS")
     → Bing News RSS HTTP call (external)
     → ThreadPoolExecutor: fetch og:description from 5 articles
     → sentiment score = +0.35 (bullish)
  2. stock_service.get_stock_analysis("TCS.NS", 0.35)
     → _cached("analysis:TCS.NS", ..., ttl=1800)
     → cache miss → _yf_info("TCS.NS") → curl_cffi → Yahoo Finance
     → _yf_history("TCS.NS", "2y") → 2 years OHLCV
     → _calculate_technicals(hist) → RSI, MACD, BB, Stoch, ATR...
     → _generate_recommendation(info, tech, 0.35) → score=+6 → "Buy"
     → _calc_valuation_metrics(info) → Graham Number, PEG, FCF yield
     → _calculate_entry_exit(price, tech, info) → buy zone, targets, SL
     → _get_sector_schemes("Technology") → PLI schemes list
     → store in _cache dict (in-memory, 30 min TTL)
    ↓
Response JSON: 200 OK
    ↓
API Gateway: forward response to browser
    ↓
React: setAnalysis(res.data) → renders tabs
```

---

## Data Flow — Avatar Upload

```
User clicks Upload Avatar
    ↓
React: POST /api/v1/users/me/avatar
       multipart/form-data; image.jpg
    ↓
API Gateway → EC2 FastAPI
    ↓
users.py: upload_avatar()
  - validate MIME type (image/jpeg ✅)
  - validate size < 3 MB ✅
  - call s3_storage.upload_avatar(bytes, "image/jpeg", user_id, "jpg")
    → s3.put_object(Bucket="nse-assets-<id>", Key="avatars/user_1_abc123.jpg")
    → returns "https://nse-assets-<id>.s3.ap-south-1.amazonaws.com/avatars/..."
  - dynamo_users.update_item: set avatar_url = S3 URL
    ↓
Response: 200 OK — updated user dict with new avatar_url
```

---

## EventBridge Pub/Sub Pattern

```
PUBLISHER                       EVENT BUS              SUBSCRIBER
─────────                       ─────────              ──────────
EventBridge Scheduler           default bus            Lambda: nse-screener-refresh
cron(0/30 6-16 MON-FRI)   ──►  event          ──►     → calls screen_stocks()
                                                        → writes to DynamoDB
                                                          screener_cache table

EC2 instance state change   ──► event          ──►     Lambda: nse-health-notifier
(start / stop / terminate)                              → SNS → Email to admin

Custom event from FastAPI:  ──► event          ──►     Lambda: nse-email-alert
events.put_events({                                     → sends email via SES
  "Source": "nse.scraping",
  "DetailType": "JobCompleted",
  "Detail": {"job_id": "...", "status": "done"}
})
```

---

## DynamoDB Access Patterns

| Endpoint | Table | Operation | Index Used |
|---|---|---|---|
| Login | users | Query | username-index GSI |
| Get user by ID | users | GetItem | Primary key |
| List all users | users | Scan | — (admin only) |
| Portfolio | stock_transactions | Query | user-transactions-index GSI |
| Watchlist | stock_watchlist | Query | user-watchlist-index GSI |
| Check dupe symbol | stock_watchlist | Query | user-symbol-index GSI |
| List jobs | scraping_jobs | Query | user-jobs-index GSI |
| Job tasks | scraping_tasks | Query | job-tasks-index GSI |
| Pending tasks | scraping_tasks | Query | status-index GSI |
| Product data | product_data | GetItem | Primary key (task_id) |

**Key insight:** Every access pattern uses a GSI Query, NOT a Scan.
Scan reads the entire table — expensive in DynamoDB (costs RCU).
GSI Query reads only matching items — efficient and within free tier.

---

## Free Tier Cost Estimate

Staging and prod are in **separate AWS accounts**. Each account has its own free tier allowance.

| Service | Per-account usage | Free Tier (per account) | Cost per account |
|---|---|---|---|
| EC2 t2.micro | 720 h | 750 h ✅ | $0 |
| S3 storage | ~200 MB | 5 GB ✅ | $0 |
| S3 requests | ~5,000 | 20K GET ✅ | $0 |
| DynamoDB storage | ~100 MB | 25 GB ✅ | $0 |
| DynamoDB RCU | ~500K | 25 × 2.5M ✅ | $0 |
| API Gateway (optional) | ~10K req/mo | 1M/mo ✅ | $0 |
| Lambda | ~1,000 runs | 1M/mo ✅ | $0 |
| CloudWatch logs | ~1 GB | 5 GB ✅ | $0 |
| Data transfer out | ~500 MB | 1 GB ✅ | $0 |
| **TOTAL (per account)** | | | **$0/mo** |
| **TOTAL (both accounts)** | | | **$0/mo** |

Both accounts run within free tier independently. After 12-month free tier (EC2/S3 — DynamoDB and Lambda are free forever), estimated cost: **~$15-20/month per account** (~$30-40/month total).

> **API Gateway note:** API Gateway is shown in the architecture diagram as an optional future entry point for REST calls. The project currently routes REST traffic directly to EC2 Nginx. API Gateway can be added later for rate limiting, HTTPS termination, and throttling without changing backend code.
