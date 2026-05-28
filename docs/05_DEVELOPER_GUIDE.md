# Developer Guide — NSE Stock Dashboard

> **New developer? Start here.** This document covers the project layout, how every request flows through the code, how to run it locally, how to add a new feature, and how to debug anything that breaks.

---

## Table of Contents

1. [Five-minute orientation](#1-five-minute-orientation)
2. [Project layout — every file explained](#2-project-layout--every-file-explained)
3. [How a request flows through the code](#3-how-a-request-flows-through-the-code)
4. [Frontend pages and what they call](#4-frontend-pages-and-what-they-call)
5. [Backend layers — the rules](#5-backend-layers--the-rules)
6. [DynamoDB tables](#6-dynamodb-tables)
7. [How authentication works](#7-how-authentication-works)
8. [How config and secrets load](#8-how-config-and-secrets-load)
9. [Run locally](#9-run-locally)
10. [Adding a new backend endpoint](#10-adding-a-new-backend-endpoint)
11. [Adding a new frontend page](#11-adding-a-new-frontend-page)
12. [Git workflow and CI/CD pipeline](#12-git-workflow-and-cicd-pipeline)
13. [Environments — staging / prod](#13-environments--staging--prod)
14. [QC testing guide](#14-qc-testing-guide)
15. [Debugging guide](#15-debugging-guide)

---

## 1. Five-minute orientation

### What is this project?

A full-stack stock analysis dashboard. React frontend + FastAPI backend + DynamoDB database. Runs on AWS (EC2 + S3 + various managed services). Two isolated stages (staging + prod) on a single EC2 instance, promoted automatically via GitHub Actions.

### Where is everything running?

| What | URL |
|------|-----|
| **Frontend — Staging** | S3 bucket → `/staging/` folder |
| **Frontend — Prod** | S3 bucket root `/` |
| **API — Staging** | `http://<EC2_IP>/staging/api/v1/` |
| **API — Prod** | `http://<EC2_IP>/api/v1/` |
| **Swagger UI — Staging** | `http://<EC2_IP>/staging/docs` |
| **Swagger UI — Prod** | `http://<EC2_IP>/docs` |
| **Health check — Staging** | `http://<EC2_IP>/staging/api/v1/health/` |
| **Health check — Prod** | `http://<EC2_IP>/api/v1/health/` |

> EC2_IP is stored as the `EC2_HOST` GitHub secret. Check `Makefile` line 23 for how the local tooling picks it up from `.ec2-host`.

### What controls which stage you're talking to?

The `STAGE` environment variable (set by systemd on EC2). It controls:
- DynamoDB table names (`stg_users` vs `users`)
- SQS queue names (`nse-scraping-jobs-staging` vs `nse-scraping-jobs`)
- SSM parameter paths (`/nse/staging/` vs `/nse/prod/`)
- FastAPI `root_path` for Swagger URL prefixes

### Quickstart (local, 5 minutes)

```bash
cp backend/.env.example backend/.env
# Set SECRET_KEY to any random string, leave everything else as-is
make local-backend    # FastAPI on http://localhost:9000/docs
make local-frontend   # React on  http://localhost:3000
```

---

## 2. Project layout — every file explained

```
aws/
│
├── backend/
│   ├── app/
│   │   ├── main.py                  ← App factory: FastAPI instance, CORS, lifespan (spawns worker)
│   │   ├── config.py                ← All settings; loads secrets from SSM at startup
│   │   ├── dependencies.py          ← JWT auth dependency: get_current_active_user
│   │   │
│   │   ├── api/v1/
│   │   │   ├── router.py            ← Assembles all endpoint routers under /api/v1
│   │   │   └── endpoints/
│   │   │       ├── auth.py          ← POST /auth/token (login), POST /auth/refresh
│   │   │       ├── users.py         ← CRUD /users, avatar upload
│   │   │       ├── stocks.py        ← Stock analysis, screener, portfolio, watchlist, sentiment
│   │   │       ├── scraping.py      ← Amazon scraping jobs + SSE progress stream
│   │   │       ├── menu.py          ← Menu and menu-access CRUD
│   │   │       └── health.py        ← GET /health (used by CI/CD pipeline)
│   │   │
│   │   ├── services/
│   │   │   ├── auth_service.py      ← login(), verify password, issue JWT
│   │   │   ├── stock_service.py     ← yfinance analysis, RSI/MACD/BB, recommendations
│   │   │   ├── sentiment_service.py ← RSS news fetch → Comprehend ML scoring
│   │   │   ├── scraper.py           ← Playwright scrape logic (called by worker.py)
│   │   │   ├── scraping_queue.py    ← SQS enqueue/dequeue wrapper
│   │   │   └── s3_storage.py        ← Upload/delete avatar files on S3
│   │   │
│   │   ├── crud/
│   │   │   ├── user_dynamo.py       ← DynamoDB reads/writes for users table
│   │   │   ├── stock_dynamo.py      ← Transactions, watchlist, screener cache
│   │   │   └── scraping_dynamo.py   ← Jobs, tasks, product data
│   │   │
│   │   ├── schemas/
│   │   │   ├── auth.py              ← LoginRequest, TokenResponse
│   │   │   ├── user.py              ← UserCreate, UserUpdate, UserOut
│   │   │   ├── stock.py             ← StockAnalysis, PortfolioItem, WatchlistItem
│   │   │   └── scraping.py          ← ScrapingJobCreate, ScrapingTaskOut
│   │   │
│   │   ├── core/
│   │   │   ├── security.py          ← hash_password, decode_token (JWT)
│   │   │   ├── roles.py             ← require_role() dependency factory
│   │   │   ├── exceptions.py        ← Reusable HTTPException instances
│   │   │   └── logging.py           ← CloudWatch-friendly log setup
│   │   │
│   │   ├── db/
│   │   │   └── dynamo.py            ← All 13 DynamoDB Table objects (stage-prefixed)
│   │   │
│   │   ├── middleware/
│   │   │   └── logging_middleware.py ← Request/response timing log
│   │   │
│   │   └── worker.py                ← SQS long-poll loop → runs Playwright scrapes
│   │
│   ├── requirements.txt
│   └── .env.example                 ← Copy to .env for local dev
│
├── frontend/
│   └── src/
│       ├── App.js                   ← Root: BrowserRouter + AuthProvider + AppRoutes
│       ├── routes/
│       │   ├── index.jsx            ← All React routes (path → component + role guard)
│       │   ├── PrivateRoute.jsx     ← Redirects to /login if not authenticated
│       │   └── RoleRoute.jsx        ← Shows /unauthorized if role not allowed
│       │
│       ├── pages/
│       │   ├── Login/               ← Login form (calls authService.login)
│       │   ├── Dashboard/           ← Home page with summary widgets
│       │   ├── StockDashboard/      ← Stock search, analysis, portfolio, watchlist, screener
│       │   ├── AmazonScraper/       ← Submit ASINs → live SSE progress
│       │   ├── ProductMaster/       ← View/edit scraped product data
│       │   ├── Users/               ← Admin: list/create/edit/delete users
│       │   ├── Menus/               ← Admin: manage navigation menus
│       │   ├── MenuAccess/          ← Admin: role → menu permission matrix
│       │   ├── Reports/             ← Reports page
│       │   ├── Settings/            ← User settings
│       │   ├── EmailAction/         ← Email-triggered actions
│       │   └── Unauthorized/        ← "You don't have access" page
│       │
│       ├── components/
│       │   ├── layout/
│       │   │   ├── Layout.jsx       ← App shell: Sidebar + TopPanel + <Outlet>
│       │   │   ├── Sidebar.jsx      ← Navigation links (reads menu from AuthContext)
│       │   │   └── TopPanel.jsx     ← Top bar with user name + logout
│       │   └── common/              ← Button, Input, Loader, Pagination, etc.
│       │
│       ├── services/
│       │   ├── api.js               ← Axios instance with base URL + JWT header
│       │   ├── authService.js       ← login(username, password), logout, refreshToken
│       │   ├── stockService.js      ← getAnalysis, getScreener, portfolio CRUD
│       │   ├── scrapingService.js   ← createJob, getJobs, SSE connection
│       │   ├── userService.js       ← getUsers, createUser, updateUser, deleteUser
│       │   ├── menuService.js       ← getMenus, getMenuAccess
│       │   └── productService.js    ← getProducts, updateProduct
│       │
│       ├── context/
│       │   └── AuthContext.jsx      ← Global auth state: user, token, menus
│       │
│       ├── hooks/
│       │   ├── useAuth.js           ← Access AuthContext
│       │   ├── useSSE.js            ← EventSource wrapper for scraping progress
│       │   ├── useMenuAccess.js     ← Check if current user can see a menu item
│       │   ├── usePagination.js     ← Page/perPage state logic
│       │   └── useSortFilter.js     ← Column sort + filter state logic
│       │
│       └── utils/
│           ├── constants.js         ← REACT_APP_API_URL (set from .env at build time)
│           └── helpers.js           ← Date formatting, number formatting
│
├── infrastructure/
│   ├── dynamodb/create_tables.py    ← Creates all DynamoDB tables for STAGE
│   ├── ssm/setup_ssm.sh             ← Stores secrets in SSM Parameter Store
│   ├── sqs/setup_sqs.sh             ← Creates SQS queue + DLQ for one stage
│   ├── sns/setup_sns.sh             ← Creates SNS alert topic + email subscription
│   ├── iam/
│   │   ├── setup_ec2_role.sh        ← EC2 instance profile (DynamoDB/S3/SSM access)
│   │   └── setup_lambda_role.sh     ← Lambda execution role
│   ├── lambda/
│   │   ├── screener_refresh/        ← Pre-computes screener cache every 30 min
│   │   ├── universe_refresh/        ← Downloads NSE symbol list daily
│   │   └── dlq_alert/               ← Fires SNS email on scraping DLQ message
│   ├── eventbridge/setup_eventbridge.sh ← Cron triggers for Lambda
│   ├── cloudfront/setup_cloudfront.sh  ← CDN distribution for S3 frontend
│   ├── cloudwatch/setup_alarms.sh      ← CloudWatch alarms + dashboard
│   └── scripts/
│       ├── ec2_setup.sh             ← Install Python, Node, Nginx, Playwright on EC2
│       ├── nginx.conf               ← Nginx: /staging/api/ → 9001, /api/ → 9000
│       ├── nse-api.service          ← systemd unit for FastAPI (prod, port 9000)
│       ├── nse-worker.service       ← systemd unit for SQS worker (prod)
│       ├── nse-api-staging.service  ← systemd unit for FastAPI (staging, port 9001)
│       ├── nse-worker-staging.service ← systemd unit for SQS worker (staging)
│       └── test_staging.sh          ← Automated smoke tests run after staging deploy
│
├── .github/workflows/deploy.yml     ← CI/CD: lint → Staging → (approval) → PROD
├── Makefile                         ← Developer shortcuts (run `make help`)
├── ruff.toml                        ← Python lint rules
└── docs/                            ← Architecture, setup, this file
```

---

## 3. How a request flows through the code

### Example: user searches a stock

```
Browser: GET /staging/api/v1/stocks/analyse/TCS.NS
         Authorization: Bearer eyJhbGci...
            │
            ▼
Nginx (/staging/api/ block in nginx.conf)
  → strips /staging prefix
  → proxies to 127.0.0.1:9001
            │
            ▼
FastAPI (backend/app/main.py)
  → LoggingMiddleware logs request start
  → routes to stocks.router via /api/v1 prefix
            │
            ▼
backend/app/api/v1/endpoints/stocks.py
  → depends on get_current_active_user (dependencies.py)
       → extracts Bearer token
       → decode_token(token) → username = "admin"   ← core/security.py
       → get_by_username("admin")                    ← crud/user_dynamo.py
          → DynamoDB Query on stg_users table (staging)
       → confirms user.is_active = True
  → calls stock_service.get_stock_analysis("TCS.NS") ← services/stock_service.py
       → checks in-memory cache (30 min TTL)
       → cache miss → yfinance.Ticker("TCS.NS")
       → calculates RSI, MACD, Bollinger Bands
       → calls sentiment_service.analyze("TCS.NS")   ← services/sentiment_service.py
            → fetches Bing/Google RSS headlines
            → calls Comprehend batch_detect_sentiment
            → returns score: +0.42 (bullish)
       → generates Buy/Sell/Hold recommendation
            │
            ▼
Response JSON: 200 OK → {analysis, sentiment, recommendation}
            │
            ▼
React: setAnalysis(data) → renders StockDashboard tabs
```

### Example: Amazon scraping job (async)

```
1. POST /staging/api/v1/scraping/jobs  { asins: ["B09XYZ"] }
   → creates job record in DynamoDB (status: pending)   ← crud/scraping_dynamo.py
   → calls scraping_queue.enqueue(task_ids)             ← services/scraping_queue.py
      → SQS SendMessage { task_id: "uuid" }

2. worker.py (separate OS process, started by main.py lifespan)
   → long-polls SQS every 20 seconds
   → receives { task_id: "uuid" }
   → reads task from DynamoDB → fetches ASIN
   → calls scraper.scrape_asin(asin)                    ← services/scraper.py
      → Playwright launches Chromium
      → navigates to amazon.in/dp/<ASIN>
      → extracts title, price, rating, image
   → SUCCESS: writes ProductData to DynamoDB, deletes SQS message
   → FAILURE: does NOT delete → SQS retries after 300s (up to 3 times)
              → after 3rd failure → SQS moves to DLQ
              → Lambda nse-dlq-alert fires → SNS email alert

3. Frontend polls or uses SSE stream for live progress
   GET /staging/api/v1/scraping/jobs/{job_id}/events  ← SSE (EventSource)
   → FastAPI yields progress updates as events
```

---

## 4. Frontend pages and what they call

| Page | Route | Backend APIs called | Roles |
|------|-------|---------------------|-------|
| Login | `/login` | `POST /auth/token` | public |
| Dashboard | `/` | `GET /stocks/global-markets`, `GET /stocks/screener` | all |
| StockDashboard | `/stocks` | `GET /stocks/analyse/:symbol`, `GET /stocks/screener`, `POST /stocks/portfolio`, `GET /stocks/portfolio`, `POST /stocks/watchlist`, `GET /stocks/sentiment/:symbol` | all |
| AmazonScraper | `/scraper` | `POST /scraping/jobs`, `GET /scraping/jobs`, SSE stream | all |
| ProductMaster | `/product-master` | `GET /scraping/products`, `PUT /scraping/products/:id` | admin, manager |
| Users | `/users` | `GET /users`, `POST /users`, `PUT /users/:id`, `DELETE /users/:id` | admin, manager |
| Menus | `/menus` | `GET /menus`, `POST /menus`, `PUT /menus/:id`, `DELETE /menus/:id` | admin |
| MenuAccess | `/menu-access` | `GET /menus/access`, `PUT /menus/access/:id` | admin |
| Reports | `/reports` | _(in development)_ | all |
| Settings | `/settings` | `GET /users/me`, `PUT /users/me`, `POST /users/me/avatar` | admin |
| EmailAction | `/email-action` | Email webhook endpoints | all |
| Unauthorized | `/unauthorized` | _(no API)_ | public |

### How the frontend gets the API URL

```javascript
// frontend/src/utils/constants.js
export const API_BASE_URL = process.env.REACT_APP_API_URL;

// frontend/src/services/api.js
const api = axios.create({ baseURL: API_BASE_URL });
// → every service (stockService, userService, etc.) uses this axios instance
```

At build time, `REACT_APP_API_URL` is injected:
- **Local**: `http://localhost:9000/api/v1` (from frontend/.env)
- **Staging build**: `http://<EC2_IP>/staging/api/v1` (from GitHub secret `STAGING_API_URL`)
- **Prod build**: `http://<EC2_IP>/api/v1` (from GitHub secret `PROD_API_URL`)

### Role-based access

Routes are wrapped in `<RoleRoute roles={[...]}>` in [routes/index.jsx](../frontend/src/routes/index.jsx). If a user's role isn't in the list, they're redirected to `/unauthorized`. The user's role comes from the JWT payload, stored in `AuthContext`.

---

## 5. Backend layers — the rules

Each layer has one job. Never mix them.

```
Request arrives
      │
      ▼
endpoints/        ← HTTP only. Read request, call service, return response.
                    No DynamoDB calls here. No business logic.
      │
      ▼
services/         ← Business logic. Orchestrate calls to CRUD and external APIs.
                    No HTTP objects (Request/Response). No direct DynamoDB.
      │
      ▼
crud/             ← DynamoDB only. One file per table group.
                    No logic, no HTTP, no services.
      │
      ▼
db/dynamo.py      ← Table object references. No logic.
```

**schemas/** — Pydantic models for request/response shapes. No methods, no DB calls.

**core/** — Utilities shared across layers: JWT encoding, password hashing, role guards, exceptions.

**Why these rules?**
- You can change database operations (crud/) without touching endpoints.
- You can change HTTP responses (endpoints/) without touching business logic.
- You can test services by mocking crud functions — no HTTP setup needed.

---

## 6. DynamoDB tables

All tables are defined in [backend/app/db/dynamo.py](../backend/app/db/dynamo.py). The stage prefix is applied automatically (`stg_` for staging, empty for prod).

| Variable | Staging table | Prod table | What it stores | Primary key | Notable GSIs |
|----------|---------------|------------|----------------|-------------|--------------|
| `dynamo_users` | `stg_users` | `users` | User accounts, roles, avatars | `user_id` | `username-index` |
| `dynamo_transactions` | `stg_stock_transactions` | `stock_transactions` | Portfolio buy/sell history | `txn_id` | `user-transactions-index` |
| `dynamo_watchlist` | `stg_stock_watchlist` | `stock_watchlist` | Saved symbols per user | `wl_id` | `user-watchlist-index`, `user-symbol-index` |
| `dynamo_jobs` | `stg_scraping_jobs` | `scraping_jobs` | Amazon scraping job metadata | `job_id` | `user-jobs-index` |
| `dynamo_tasks` | `stg_scraping_tasks` | `scraping_tasks` | Individual ASIN tasks within a job | `task_id` | `job-tasks-index`, `status-index` |
| `dynamo_products` | `stg_product_data` | `product_data` | Scraped Amazon product results | `task_id` | — |
| `dynamo_screener_cache` | `stg_screener_cache` | `screener_cache` | Pre-computed screener results | `cache_key` | — |
| `dynamo_menus` | `stg_menus` | `menus` | Navigation menu definitions | `menu_id` | — |
| `dynamo_menu_access` | `stg_menu_access` | `menu_access` | Role → menu permission matrix | `access_id` | `menu-index`, `role-index` |
| `dynamo_email_messages` | `stg_email_messages` | `email_messages` | Inbound email messages | `message_id` | — |
| `dynamo_email_sync_state` | `stg_email_sync_state` | `email_sync_state` | IMAP sync cursor (singleton) | `sync_key` | — |
| `dynamo_product_master` | `stg_product_master` | `product_master` | Canonical product content | `product_id` | — |
| `dynamo_word_suggestions` | `stg_word_suggestions` | `word_suggestions` | AI phrase suggestions | `suggestion_id` | — |

> **Rule:** Always query via GSI, never scan. Scans read the whole table and consume read capacity. Every access pattern in this project uses a targeted Query.

> **Isolation guarantee:** Staging uses `stg_` prefix — it is physically impossible for staging code to read or write prod data. Both stages share one AWS account and one EC2.

### Create tables for a stage

```bash
STAGE=staging python3 infrastructure/dynamodb/create_tables.py
STAGE=prod    python3 infrastructure/dynamodb/create_tables.py
```

---

## 7. How authentication works

### Login flow (step by step)

```
1. User submits username + password on Login page
2. authService.login() → POST /api/v1/auth/token
3. auth.py endpoint → auth_service.login(username, password)
      → crud/user_dynamo.get_by_username(username)
         → DynamoDB Query on username-index GSI
      → core/security.verify_password(password, user["hashed_password"])
         → bcrypt.checkpw()
      → core/security.create_access_token({"sub": username})
         → jwt.encode(payload, SECRET_KEY, algorithm="HS256")
         → token expires in 1440 minutes (24 hours)
4. Returns: { access_token: "eyJ...", token_type: "bearer" }
5. Frontend stores token in AuthContext + localStorage
```

### Protecting an endpoint

Every protected endpoint adds this dependency:

```python
from app.dependencies import get_current_active_user
from fastapi import Depends

@router.get("/my-endpoint")
def my_endpoint(current_user: dict = Depends(get_current_active_user)):
    # current_user is the DynamoDB user dict
    # current_user["username"], current_user["role"] are available
    ...
```

### Role-based access (backend)

```python
from app.core.roles import require_role

@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    ...
```

`require_role("admin")` builds a dependency that calls `get_current_active_user` and then checks `user["role"] == "admin"`, returning 403 otherwise.

---

## 8. How config and secrets load

Every setting is in [backend/app/config.py](../backend/app/config.py). Reading it takes 2 minutes and saves hours of confusion.

### Startup order

```
1. Systemd sets STAGE=staging (EnvironmentFile=/opt/nse-staging/.env)
2. Settings() reads backend/.env (pydantic-settings)
3. get_settings() checks: is SECRET_KEY empty?
      → yes → calls _ssm_get("/nse/staging/jwt-secret")
      → reads SecureString from SSM Parameter Store using EC2 instance role
4. Same for: GMAIL_USER, GMAIL_APP_PASSWORD, SQS_SCRAPING_JOBS_URL, SNS_ALERTS_ARN, S3_ASSETS_BUCKET
5. Result cached by @lru_cache — SSM called exactly once per process
6. Any code imports: from app.config import settings
```

### Local development: no SSM needed

Set values in `backend/.env`. If the field is non-empty, SSM is skipped. The minimum `.env` for local dev:

```env
STAGE=staging
SECRET_KEY=any-random-string-at-least-32-chars
COMPREHEND_ENABLED=false   # avoids Comprehend AWS calls
SQS_SCRAPING_JOBS_URL=     # empty → falls back to in-memory queue
```

### How table names are derived

```python
# config.py
@property
def table_prefix(self) -> str:
    # prod → ""      → table name: "users"
    # staging → "stg_" → table name: "stg_users"
    return "" if self.STAGE == "prod" else "stg_"

# db/dynamo.py
_p = settings.table_prefix   # "stg_" or ""
dynamo_users = _dynamodb.Table(f"{_p}users")
# → "stg_users" in staging, "users" in prod
```

---

## 9. Run locally

### Prerequisites

- Python 3.11+, Node.js 20+, AWS CLI configured (`aws configure`)
- DynamoDB tables must exist: `STAGE=staging python3 infrastructure/dynamodb/create_tables.py`

### One-time setup

```bash
cd /path/to/aws

# Backend
cp backend/.env.example backend/.env
# Edit backend/.env: set SECRET_KEY to any random string

pip install -r backend/requirements.txt      # or: make install-backend
cd frontend && npm install && cd ..           # or: make install-frontend
```

### Start (two terminals)

```bash
# Terminal 1
make local-backend    # FastAPI on http://localhost:9000
                      # Swagger UI: http://localhost:9000/docs

# Terminal 2
make local-frontend   # React on http://localhost:3000
```

### Create the first admin user (local)

```bash
cd backend
source venv/bin/activate   # if using a venv
python3 - <<'EOF'
import os; os.environ["STAGE"] = "staging"
from app.db.dynamo import dynamo_users
from app.core.security import hash_password
import uuid, datetime
dynamo_users.put_item(Item={
    "user_id": str(uuid.uuid4()),
    "username": "admin",
    "email": "admin@example.com",
    "full_name": "Admin User",
    "role": "admin",
    "hashed_password": hash_password("changeme123"),
    "is_active": True,
    "created_at": datetime.datetime.utcnow().isoformat(),
})
print("Done — login with admin / changeme123")
EOF
```

### What works locally vs on AWS

| Feature | Local | AWS |
|---------|-------|-----|
| Login / JWT | ✓ | ✓ |
| Stock analysis (yfinance) | ✓ | ✓ |
| Sentiment (keyword fallback) | ✓ with `COMPREHEND_ENABLED=false` | ✓ (Comprehend) |
| Portfolio / Watchlist | ✓ (needs DynamoDB) | ✓ |
| Playwright scraping | ✓ if Chromium installed | ✓ |
| Avatar upload | ✗ (needs S3) | ✓ |
| SQS queue | in-memory fallback | ✓ |

---

## 10. Adding a new backend endpoint

Use this as a complete checklist every time.

### Step 1 — Create the endpoint file

```bash
# Copy an existing simple endpoint as a starting point
cp backend/app/api/v1/endpoints/health.py backend/app/api/v1/endpoints/alerts.py
```

Structure of `alerts.py`:

```python
from fastapi import APIRouter, Depends
from app.dependencies import get_current_active_user
from app.schemas.alerts import AlertOut        # you'll create this
from app.services import alerts_service        # you'll create this

router = APIRouter()

@router.get("/", response_model=list[AlertOut])
def list_alerts(current_user: dict = Depends(get_current_active_user)):
    return alerts_service.get_alerts(current_user["user_id"])
```

### Step 2 — Create the schema (Pydantic models)

```python
# backend/app/schemas/alerts.py
from pydantic import BaseModel

class AlertOut(BaseModel):
    alert_id: str
    message: str
    created_at: str
```

### Step 3 — Create the service (business logic)

```python
# backend/app/services/alerts_service.py
from app.crud import alerts_dynamo   # you'll create this

def get_alerts(user_id: str) -> list[dict]:
    return alerts_dynamo.list_by_user(user_id)
```

### Step 4 — Create the CRUD (DynamoDB operations)

```python
# backend/app/crud/alerts_dynamo.py
from app.db.dynamo import dynamo_alerts   # add this table to db/dynamo.py

def list_by_user(user_id: str) -> list[dict]:
    resp = dynamo_alerts.query(
        IndexName="user-alerts-index",
        KeyConditionExpression="user_id = :uid",
        ExpressionAttributeValues={":uid": user_id},
    )
    return resp.get("Items", [])
```

### Step 5 — Register the router

```python
# backend/app/api/v1/router.py  (add these two lines)
from app.api.v1.endpoints import alerts
api_router.include_router(alerts.router, prefix="/alerts", tags=["Alerts"])
```

### Step 6 — Add the DynamoDB table (if new)

```python
# backend/app/db/dynamo.py  (add one line)
dynamo_alerts = _table("alerts")
```

```bash
# Create the table on AWS for both stages
STAGE=staging python3 infrastructure/dynamodb/create_tables.py
STAGE=prod    python3 infrastructure/dynamodb/create_tables.py
```

### Step 7 — Test

```bash
make local-backend
# Open http://localhost:9000/docs → find your new route → try it
```

---

## 11. Adding a new frontend page

### Step 1 — Create the page component

```bash
mkdir -p frontend/src/pages/Alerts
```

```jsx
// frontend/src/pages/Alerts/index.jsx
import React, { useEffect, useState } from 'react';
import api from '../../services/api';

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    api.get('/alerts/').then(res => setAlerts(res.data));
  }, []);

  return (
    <div>
      <h2>Alerts</h2>
      {alerts.map(a => <p key={a.alert_id}>{a.message}</p>)}
    </div>
  );
}
```

### Step 2 — Add the route

```jsx
// frontend/src/routes/index.jsx  (add import + Route)
import Alerts from '../pages/Alerts';

// Inside <Routes>:
<Route path="alerts" element={
  <RoleRoute roles={['admin', 'manager']}>
    <Alerts />
  </RoleRoute>
} />
```

### Step 3 — Add navigation (optional)

```jsx
// frontend/src/components/layout/Sidebar.jsx
// Add a link alongside the existing nav items:
<NavLink to="/alerts">Alerts</NavLink>
```

### Step 4 — Create a service file (if making many API calls)

```javascript
// frontend/src/services/alertsService.js
import api from './api';

export const getAlerts = () => api.get('/alerts/');
export const dismissAlert = (id) => api.delete(`/alerts/${id}`);
```

---

## 12. Git workflow and CI/CD pipeline

### Branch strategy

```
main      ← production-only. Protected. Only CI/CD pushes here via promotion.
develop   ← all development happens here. Push here to trigger the pipeline.
```

**Never commit directly to `main`.** All changes go to `develop`.

### What happens when you push

```bash
git add .
git commit -m "feat: your change description"
git push origin develop
```

```
GitHub Actions triggered: .github/workflows/deploy.yml
        │
        ▼
┌───────────────┐
│  Lint & Test  │  ruff check backend/app/ + npm ci
│               │  Build staging frontend (PUBLIC_URL=/staging)
│               │  Build prod frontend (PUBLIC_URL=/)
│               │  Upload both as artifacts
│               │  Takes ~3 min
└──────┬────────┘
       │ PASS
       ▼
┌───────────────┐
│ Deploy STAGING│  rsync backend → /opt/nse-staging/backend/
│               │  pip install → restart nse-api-staging nse-worker-staging
│               │  curl /staging/api/v1/health/ → must return 200
│               │  Upload frontend artifact → S3 /staging/ folder
└──────┬────────┘
       │ PASS (health check)
       ▼
┌───────────────┐
│ ⏳ Approval   │  GitHub sends email to the reviewer
│               │  Go to: GitHub → Actions → latest run → "Review deployments"
└──────┬────────┘
       │ APPROVED
       ▼
┌───────────────┐
│  Deploy PROD  │  rsync backend → /opt/nse/backend/
│               │  pip install → restart nse-api nse-worker
│               │  curl /api/v1/health/ → must return 200
│               │  Upload frontend artifact → S3 root
└───────────────┘
```

**If any step fails** — all later stages are skipped automatically.

### Monitor the pipeline

GitHub → your repo → **Actions** tab → click the latest "Deploy Pipeline" run.

### Approve PROD deployment

GitHub → Actions → latest run → **"Review deployments"** button (bottom of page) → tick `prod` → **Approve and deploy**.

### Lint before pushing

```bash
make lint                        # ruff check (Python)
cd frontend && npm run build     # checks for JS/TypeScript errors
```

---

## 13. Environments — staging / prod

Two stages on a **single EC2, single AWS account**. The `stg_` DynamoDB prefix ensures staging code can never touch production data.

| | Staging | Prod |
|-|---------|------|
| **Purpose** | Pre-release testing — QC team validates here before approve | Live users |
| **Deploy trigger** | Auto — every `develop` push (after lint passes) | Manual approval in GitHub |
| **EC2 directory** | `/opt/nse-staging/` | `/opt/nse/` |
| **FastAPI port** | 9001 | 9000 |
| **API base URL** | `http://<EC2_HOST>/staging/api/v1` | `http://<EC2_HOST>/api/v1` |
| **Swagger UI** | `http://<EC2_HOST>/staging/docs` | `http://<EC2_HOST>/docs` |
| **systemd services** | `nse-api-staging`, `nse-worker-staging` | `nse-api`, `nse-worker` |
| **DynamoDB tables** | `stg_users`, `stg_stock_transactions`… | `users`, `stock_transactions`… |
| **SQS queue** | `nse-scraping-jobs-staging` | `nse-scraping-jobs` |
| **SSM path** | `/nse/staging/` | `/nse/prod/` |
| **Frontend S3** | `nse-frontend-<account-id>/staging/` | `nse-frontend-<account-id>/` root |

### GitHub Secrets required

Set these in: **GitHub repo → Settings → Secrets and variables → Actions**

| Secret | Value |
|--------|-------|
| `EC2_HOST` | Your Elastic IP |
| `EC2_SSH_KEY` | Full contents of `~/.ssh/nse-keypair.pem` (including BEGIN/END lines) |
| `AWS_ACCESS_KEY_ID` | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `S3_FRONTEND_BUCKET` | `nse-frontend-<your-account-id>` |
| `STAGING_API_URL` | `http://<EC2_HOST>/staging/api/v1` |
| `STAGING_SSE_URL` | `http://<EC2_HOST>` |
| `PROD_API_URL` | `http://<EC2_HOST>/api/v1` |
| `PROD_SSE_URL` | `http://<EC2_HOST>` |

### GitHub Environments required

**Settings → Environments** → create two environments:

| Environment | Protection |
|-------------|-----------|
| `staging` | None — auto-deploys on every push |
| `prod` | Required reviewers → add your GitHub username |

---

## 14. QC testing guide

Staging deploys automatically after every `develop` push. Before clicking **Approve and deploy** for prod, QC runs through these checks.

### Automated smoke tests (run first)

The CI/CD pipeline runs these automatically, but you can also run them manually:

```bash
make test-staging EC2_HOST=<ELASTIC-IP>
```

This runs `infrastructure/scripts/test_staging.sh` and checks 10 API endpoints:

| # | Check | What it verifies |
|---|-------|-----------------|
| 1 | Health endpoint | Service is up and reachable |
| 2 | Login → JWT token | Auth flow works end-to-end |
| 3 | Stock analysis (RELIANCE.NS) | yfinance + calculation pipeline |
| 4 | Global markets (dashboard) | Nifty/Sensex data endpoint |
| 5 | Screener endpoint | List returns correctly |
| 6 | Get own user profile | JWT auth on protected endpoint |
| 7 | Menu list | Menu data accessible |
| 8 | Create scraping job | SQS enqueue works |
| 9 | List scraping jobs | DynamoDB query works |
| 10 | Invalid token → 401 | Auth rejection working |

All 10 must pass before QC proceeds to manual checks.

### Manual QC checklist

Open the staging frontend URL, log in with the staging admin account (`admin` / `changeme123`), then test each area:

#### Authentication
- [ ] Log in with valid credentials → reaches Dashboard
- [ ] Log out → redirected to Login page, token cleared
- [ ] Try wrong password → see error message, not a crash
- [ ] Token expiry: manually delete token from localStorage → page redirects to login without error

#### Dashboard
- [ ] Dashboard loads without spinner hanging
- [ ] Nifty/Sensex cards show real numbers (not 0 or NaN)
- [ ] Screener table loads with rows

#### Stock Dashboard
- [ ] Search for `RELIANCE.NS` → analysis card appears with RSI, MACD, BB values
- [ ] Search for a non-existent symbol `FAKE.NS` → error message shown (not a blank screen)
- [ ] Add stock to portfolio → row appears in portfolio table
- [ ] Add stock to watchlist → appears in watchlist tab
- [ ] Screener tab loads and shows results

#### Amazon Scraper
- [ ] Enter a valid ASIN (e.g. `B09XXXXX`) → job created → status shows "pending"
- [ ] SSE progress updates appear in real time (check browser Network tab for EventSource)
- [ ] Completed job shows product title and price

#### User Management (admin)
- [ ] List users → table loads
- [ ] Create a new test user (role: viewer) → appears in list
- [ ] Edit user's full name → change saved
- [ ] Delete the test user → removed from list

#### Menu / Access
- [ ] Menu list loads
- [ ] Menu access matrix loads and is editable

#### Settings
- [ ] Current user profile loads
- [ ] Change display name → saved and shown in top bar

#### Role restrictions
- [ ] Log in as a viewer-role user → cannot access Users page (/unauthorized shown)
- [ ] Viewer can access Dashboard and Stock Dashboard

#### Error handling
- [ ] Kill the staging API (`sudo systemctl stop nse-api-staging`) → frontend shows meaningful error, not blank white screen
- [ ] Restart the staging API → everything recovers without refresh

### After manual QC passes

```
GitHub → Actions → latest run → "Review deployments" → tick prod → Approve and deploy
```

The prod deployment runs the same pipeline steps. After prod deploys, verify:

```bash
curl http://<EC2_HOST>/api/v1/health/   # → {"status":"ok"}
```

Then spot-check the prod frontend URL (S3 bucket root) for the login page.

### If a staging test fails

Do **not** approve prod deployment. Instead:

```bash
# Check what's wrong
make logs EC2_HOST=<IP>              # API logs
make logs-worker EC2_HOST=<IP>       # Worker logs
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<IP>

# On EC2: check service status
sudo systemctl status nse-api-staging
sudo journalctl -u nse-api-staging -n 50 --no-pager
```

Fix the issue on `develop`, push again. The pipeline will re-run staging automatically.

---

## 15. Debugging guide

### Step 1: figure out which layer is broken

```
Browser shows error?
  → Check browser console (F12 → Console tab) for the exact HTTP response
  → Is it a 401? → JWT expired or missing. Logout and log in again.
  → Is it a 404? → Wrong URL or route not registered in router.py.
  → Is it a 422? → Request body doesn't match the Pydantic schema.
  → Is it a 500? → Backend threw an exception. Check the logs.
  → Is it a 502? → Nginx can't reach FastAPI. Service is down.
  → Is it a network error (ERR_NETWORK)? → Backend URL is wrong in .env.
```

### Check EC2 service status

```bash
# SSH into EC2
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<EC2_IP>

# Is the service running?
sudo systemctl status nse-api-staging
sudo systemctl status nse-api

# Live logs (Ctrl+C to stop)
sudo journalctl -u nse-api-staging -f

# Last 50 log lines
sudo journalctl -u nse-api-staging -n 50 --no-pager
```

Or from your local machine:
```bash
make logs              # staging API logs
make logs STAGE=prod   # prod API logs
make logs-worker       # staging worker logs
```

### Common problems and exact fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `502 Bad Gateway` | FastAPI service not running | `sudo systemctl restart nse-api-staging` |
| Service crashes at start | Missing `.env` or wrong Python path | `journalctl -u nse-api-staging -n 30` to see the error |
| `ValidationError: SECRET_KEY` | Empty SECRET_KEY and SSM unreachable | Add `SECRET_KEY=any-string` to `/opt/nse-staging/.env` |
| `Could not import module app.main` | Backend files not deployed | Run `make deploy STAGE=staging` |
| `DynamoDB ResourceNotFoundException` | Tables don't exist for this stage | `STAGE=staging python3 infrastructure/dynamodb/create_tables.py` |
| CI pipeline SSH fails (`Connection reset by peer`) | EC2 security group blocks GitHub IPs | Add SSH inbound rule: `0.0.0.0/0` in EC2 security group |
| Health check returns 502 in CI | Service takes >40s to start | Already using 40s sleep; check `journalctl` for startup errors |
| `No space left on device` | EC2 disk full | `sudo rm -rf ~/.cache/pip /tmp/pip-* && df -h` to verify |
| Frontend shows old version | S3 cache | Hard refresh: `Ctrl+Shift+R` or clear browser cache |
| Sentiment returns `"scored_by": "keywords"` | `COMPREHEND_ENABLED=false` in .env | Set `COMPREHEND_ENABLED=true` and restart service |
| SQS messages stuck | Worker crashed | `sudo systemctl restart nse-worker-staging`, check worker logs |
| Staging uses prod DynamoDB tables | `STAGE=prod` set in staging env | Check `/opt/nse-staging/.env` — must have `STAGE=staging` |

### Trace a bug from browser to database

```bash
# 1. Get the exact error from browser console (Network tab → failed request → Response)

# 2. Reproduce it on the API directly (skip the frontend)
curl -X GET "http://<EC2_IP>/staging/api/v1/stocks/analyse/TCS.NS" \
  -H "Authorization: Bearer <your-jwt-token>"
# Get a JWT token: POST /staging/api/v1/auth/token with username/password

# 3. Check the logs for the matching request
sudo journalctl -u nse-api-staging -n 100 --no-pager | grep "TCS.NS"

# 4. Check DynamoDB if it's a data issue
aws dynamodb get-item \
  --table-name stg_users \
  --key '{"user_id": {"S": "your-user-id"}}' \
  --region ap-south-1
```

### Check which version is deployed

```bash
# On EC2, look at when the files were last synced
ls -la /opt/nse-staging/backend/app/

# Or check the git log on the GitHub Actions run
# GitHub → Actions → latest "Deploy Staging" run → "Sync backend" step
```

### View logs in AWS Console

CloudWatch → Log groups → `/nse/api` → Log streams → latest stream

---

*This guide covers the current state of the project. If something is wrong or out of date, the source of truth is the code itself — `backend/app/config.py` for settings, `backend/app/db/dynamo.py` for tables, and `.github/workflows/deploy.yml` for the pipeline.*
