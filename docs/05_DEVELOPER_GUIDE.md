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
13. [Environments — dev / qc / prod](#13-environments--dev--qc--prod)
14. [Debugging guide](#14-debugging-guide)

---

## 1. Five-minute orientation

### What is this project?

A full-stack stock analysis dashboard. React frontend + FastAPI backend + DynamoDB database. Runs on AWS (EC2 + S3 + various managed services). Three isolated stages (dev/qc/prod) on a single EC2 instance, promoted automatically via GitHub Actions.

### Where is everything running?

| What | URL |
|------|-----|
| **Frontend — DEV** | S3 bucket → `/dev/` folder |
| **Frontend — PROD** | S3 bucket root `/` → CloudFront CDN |
| **API — DEV** | `http://<EC2_IP>/dev/api/v1/` |
| **API — QC** | `http://<EC2_IP>/qc/api/v1/` |
| **API — PROD** | `http://<EC2_IP>/api/v1/` |
| **Swagger UI — DEV** | `http://<EC2_IP>/dev/docs` |
| **Swagger UI — QC** | `http://<EC2_IP>/qc/docs` |
| **Swagger UI — PROD** | `http://<EC2_IP>/docs` |
| **Health check — DEV** | `http://<EC2_IP>/dev/api/v1/health/` |

> EC2_IP is stored as the `EC2_HOST` GitHub secret. Check `Makefile` line 28 for how the local tooling picks it up.

### What controls which stage you're talking to?

The `STAGE` environment variable (set by systemd on EC2). It controls:
- DynamoDB table names (`dev_users`, `qc_users`, `users`)
- SQS queue names (`nse-scraping-jobs-dev`, etc.)
- SSM parameter paths (`/nse/dev/`, `/nse/qc/`, `/nse/prod/`)
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
│       ├── nginx.conf               ← Nginx config: /dev/→9001, /qc/→9002, /→9000
│       ├── nse-api.service          ← systemd unit for FastAPI (prod)
│       ├── nse-worker.service       ← systemd unit for SQS worker (prod)
│       └── deploy.sh                ← rsync backend to EC2 + restart services
│
├── .github/workflows/deploy.yml     ← CI/CD: lint → DEV → QC → (approval) → PROD
├── Makefile                         ← Developer shortcuts (run `make help`)
├── ruff.toml                        ← Python lint rules
└── docs/                            ← Architecture, setup, this file
```

---

## 3. How a request flows through the code

### Example: user searches a stock

```
Browser: GET /dev/api/v1/stocks/analyse/TCS.NS
         Authorization: Bearer eyJhbGci...
            │
            ▼
Nginx (/dev/api/ block in nginx.conf)
  → strips /dev prefix
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
1. POST /dev/api/v1/scraping/jobs  { asins: ["B09XYZ"] }
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
   GET /dev/api/v1/scraping/jobs/{job_id}/events  ← SSE (EventSource)
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
- **DEV build**: `http://<EC2_IP>/dev/api/v1` (from GitHub secret `DEV_API_URL`)
- **PROD build**: `http://<EC2_IP>/api/v1` (from GitHub secret `PROD_API_URL` — not yet set)

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

All tables are defined in [backend/app/db/dynamo.py](../backend/app/db/dynamo.py). The stage prefix is applied automatically (`dev_`, `qc_`, or nothing for prod).

| Variable | Table (prod name) | What it stores | Primary key | Notable GSIs |
|----------|-------------------|----------------|-------------|--------------|
| `dynamo_users` | `users` | User accounts, roles, avatars | `user_id` | `username-index` |
| `dynamo_transactions` | `stock_transactions` | Portfolio buy/sell history | `txn_id` | `user-transactions-index` |
| `dynamo_watchlist` | `stock_watchlist` | Saved symbols per user | `wl_id` | `user-watchlist-index`, `user-symbol-index` |
| `dynamo_jobs` | `scraping_jobs` | Amazon scraping job metadata | `job_id` | `user-jobs-index` |
| `dynamo_tasks` | `scraping_tasks` | Individual ASIN tasks within a job | `task_id` | `job-tasks-index`, `status-index` |
| `dynamo_products` | `product_data` | Scraped Amazon product results | `task_id` | — |
| `dynamo_screener_cache` | `screener_cache` | Pre-computed screener results | `cache_key` | — |
| `dynamo_menus` | `menus` | Navigation menu definitions | `menu_id` | — |
| `dynamo_menu_access` | `menu_access` | Role → menu permission matrix | `access_id` | `menu-index`, `role-index` |
| `dynamo_email_messages` | `email_messages` | Inbound email messages | `message_id` | — |
| `dynamo_email_sync_state` | `email_sync_state` | IMAP sync cursor (singleton) | `sync_key` | — |
| `dynamo_product_master` | `product_master` | Canonical product content | `product_id` | — |
| `dynamo_word_suggestions` | `word_suggestions` | AI phrase suggestions | `suggestion_id` | — |

> **Rule:** Always query via GSI, never scan. Scans read the whole table and consume read capacity. Every access pattern in this project uses a targeted Query.

### Create tables for a new stage

```bash
STAGE=dev python3 infrastructure/dynamodb/create_tables.py
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
1. Systemd sets STAGE=dev (EnvironmentFile=/opt/nse-dev/.env)
2. Settings() reads backend/.env (pydantic-settings)
3. get_settings() checks: is SECRET_KEY empty?
      → yes → calls _ssm_get("/nse/dev/jwt-secret")
      → reads SecureString from SSM Parameter Store using EC2 instance role
4. Same for: GMAIL_USER, GMAIL_APP_PASSWORD, SQS_SCRAPING_JOBS_URL, SNS_ALERTS_ARN, S3_ASSETS_BUCKET
5. Result cached by @lru_cache — SSM called exactly once per process
6. Any code imports: from app.config import settings
```

### Local development: no SSM needed

Set values in `backend/.env`. If the field is non-empty, SSM is skipped. The minimum `.env` for local dev:

```env
STAGE=dev
SECRET_KEY=any-random-string-at-least-32-chars
COMPREHEND_ENABLED=false   # avoids Comprehend AWS calls
SQS_SCRAPING_JOBS_URL=     # empty → falls back to in-memory queue
```

### How table names are derived

```python
# config.py
@property
def table_prefix(self) -> str:
    return "" if self.STAGE == "prod" else f"{self.STAGE}_"

# db/dynamo.py
_p = settings.table_prefix   # "dev_" or "qc_" or ""
dynamo_users = _dynamodb.Table(f"{_p}users")
# → "dev_users" in dev, "qc_users" in qc, "users" in prod
```

---

## 9. Run locally

### Prerequisites

- Python 3.11+, Node.js 20+, AWS CLI configured (`aws configure`)
- DynamoDB tables must exist: `STAGE=dev python3 infrastructure/dynamodb/create_tables.py`

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
# Create the table on AWS
STAGE=dev python3 infrastructure/dynamodb/create_tables.py
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
│  Lint & Test  │  ruff check backend/app/ + npm run build (frontend)
│               │  Takes ~2 min
└──────┬────────┘
       │ PASS
       ▼
┌───────────────┐
│  Deploy DEV   │  rsync backend → /opt/nse-dev/backend/
│               │  pip install → systemctl restart nse-api-dev nse-worker-dev
│               │  curl /dev/api/v1/health/ → must return 200
│               │  Upload frontend build → S3 /dev/ folder
└──────┬────────┘
       │ PASS (health check)
       ▼
┌───────────────┐
│  Deploy QC    │  same process → /opt/nse-qc/ → port 9002
│               │  curl /qc/api/v1/health/ → must return 200
└──────┬────────┘
       │ PASS
       ▼
┌───────────────┐
│ ⏳ Approval   │  GitHub sends email to the reviewer
│               │  Go to: GitHub → Actions → latest run → "Review deployments"
└──────┬────────┘
       │ APPROVED
       ▼
┌───────────────┐
│  Deploy PROD  │  same process → /opt/nse/ → port 9000
│               │  Upload frontend → S3 root → CloudFront invalidation
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

## 13. Environments — dev / qc / prod

Three stages, **three separate AWS accounts**. Each account has its own EC2, DynamoDB, SQS, S3, and SSM. The EC2 setup is identical in every account — only the `STAGE` value in `/opt/nse/.env` differs.

| | DEV | QC | PROD |
|-|-----|----|------|
| **Purpose** | Daily development | Pre-release testing | Live users |
| **Deploy trigger** | Auto — every `develop` push | Auto — after DEV passes | Manual approval required |
| **AWS account** | nse-dev | nse-qc | nse-prod |
| **EC2 directory** | `/opt/nse` | `/opt/nse` | `/opt/nse` |
| **FastAPI port** | 9000 | 9000 | 9000 |
| **API base URL** | `http://<DEV_EC2_HOST>/api/v1` | `http://<QC_EC2_HOST>/api/v1` | `http://<EC2_HOST>/api/v1` |
| **Swagger UI** | `http://<DEV_EC2_HOST>/docs` | `http://<QC_EC2_HOST>/docs` | `http://<EC2_HOST>/docs` |
| **systemd services** | `nse-api`, `nse-worker` | `nse-api`, `nse-worker` | `nse-api`, `nse-worker` |
| **DynamoDB tables** | `users`, `stock_transactions`… | `users`, `stock_transactions`… | `users`, `stock_transactions`… |
| **SQS queue** | `nse-scraping-jobs` | `nse-scraping-jobs` | `nse-scraping-jobs` |
| **SSM path** | `/nse/` | `/nse/` | `/nse/` |
| **Frontend S3** | `DEV_S3_FRONTEND_BUCKET` root | `QC_S3_FRONTEND_BUCKET` root | `S3_FRONTEND_BUCKET` root |

### GitHub Secrets required

Set these in: **GitHub repo → Settings → Secrets and variables → Actions**

| Secret | Value |
|--------|-------|
| `EC2_SSH_KEY` | Full contents of your `.pem` key file (shared across accounts) |
| `DEV_EC2_HOST` | DEV EC2 public IP |
| `DEV_AWS_ACCESS_KEY_ID` | IAM key for dev account |
| `DEV_AWS_SECRET_ACCESS_KEY` | IAM secret for dev account |
| `DEV_S3_FRONTEND_BUCKET` | `nse-frontend-<dev-account-id>` |
| `DEV_API_URL` | `http://<DEV_EC2_HOST>/api/v1` |
| `DEV_SSE_URL` | `http://<DEV_EC2_HOST>` |
| `QC_EC2_HOST` | QC EC2 public IP |
| `QC_AWS_ACCESS_KEY_ID` | IAM key for qc account |
| `QC_AWS_SECRET_ACCESS_KEY` | IAM secret for qc account |
| `QC_S3_FRONTEND_BUCKET` | `nse-frontend-<qc-account-id>` |
| `QC_API_URL` | `http://<QC_EC2_HOST>/api/v1` |
| `QC_SSE_URL` | `http://<QC_EC2_HOST>` |
| `EC2_HOST` | PROD EC2 public IP |
| `AWS_ACCESS_KEY_ID` | IAM key for prod account |
| `AWS_SECRET_ACCESS_KEY` | IAM secret for prod account |
| `S3_FRONTEND_BUCKET` | `nse-frontend-<prod-account-id>` |
| `PROD_API_URL` | `http://<EC2_HOST>/api/v1` |
| `PROD_SSE_URL` | `http://<EC2_HOST>` |

### GitHub Environments required

**Settings → Environments** → create three environments:

| Environment | Protection |
|-------------|-----------|
| `dev` | None |
| `qc` | None |
| `prod` | Required reviewers → add your GitHub username |

---

## 14. Debugging guide

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
ssh -i ~/.ssh/nse-key.pem ubuntu@<EC2_IP>

# Is the service running?
sudo systemctl status nse-api-dev
sudo systemctl status nse-api-qc
sudo systemctl status nse-api

# Live logs (Ctrl+C to stop)
sudo journalctl -u nse-api-dev -f

# Last 50 log lines
sudo journalctl -u nse-api-dev -n 50 --no-pager
```

Or from your local machine:
```bash
make logs              # DEV API logs
make logs STAGE=prod   # PROD API logs
make logs-worker       # SQS worker logs
```

### Common problems and exact fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `502 Bad Gateway` | FastAPI service not running | `sudo systemctl restart nse-api-dev` |
| Service crashes at start | Missing `.env` or wrong Python path | `journalctl -u nse-api-dev -n 30` to see the error |
| `ValidationError: SECRET_KEY` | Empty SECRET_KEY and SSM unreachable | Add `SECRET_KEY=any-string` to `/opt/nse-dev/.env` |
| `Could not import module app.main` | Backend files not deployed | Run `make deploy STAGE=dev` |
| `DynamoDB ResourceNotFoundException` | Tables don't exist for this stage | `STAGE=dev python3 infrastructure/dynamodb/create_tables.py` |
| CI pipeline SSH fails (`Connection reset by peer`) | EC2 security group blocks GitHub IPs | Add SSH inbound rule: `0.0.0.0/0` in EC2 security group |
| Health check returns 502 in CI | Service takes >40s to start | Already using 40s sleep; check `journalctl` for startup errors |
| `No space left on device` | EC2 disk full | `sudo rm -rf ~/.cache/pip /tmp/pip-* && df -h` to verify |
| Frontend shows old version | S3 cache | Hard refresh: `Ctrl+Shift+R` or clear browser cache |
| Sentiment returns `"scored_by": "keywords"` | `COMPREHEND_ENABLED=false` in .env | Set `COMPREHEND_ENABLED=true` and restart service |
| SQS messages stuck | Worker crashed | `sudo systemctl restart nse-worker-dev`, check worker logs |

### Trace a bug from browser to database

```bash
# 1. Get the exact error from browser console (Network tab → failed request → Response)

# 2. Reproduce it on the API directly (skip the frontend)
curl -X GET "http://<EC2_IP>/dev/api/v1/stocks/analyse/TCS.NS" \
  -H "Authorization: Bearer <your-jwt-token>"
# Get a JWT token: POST /dev/api/v1/auth/token with username/password

# 3. Check the logs for the matching request
sudo journalctl -u nse-api-dev -n 100 --no-pager | grep "TCS.NS"

# 4. Check DynamoDB if it's a data issue
aws dynamodb get-item \
  --table-name dev_users \
  --key '{"user_id": {"S": "your-user-id"}}' \
  --region ap-south-1
```

### Check which version is deployed

```bash
# On EC2, look at when the files were last synced
ls -la /opt/nse-dev/backend/app/

# Or check the git log on the GitHub Actions run
# GitHub → Actions → latest Deploy DEV run → "Sync backend" step
```

### View logs in AWS Console

CloudWatch → Log groups → `/nse/api` → Log streams → latest stream

---

*This guide covers the current state of the project. If something is wrong or out of date, the source of truth is the code itself — `backend/app/config.py` for settings, `backend/app/db/dynamo.py` for tables, and `.github/workflows/deploy.yml` for the pipeline.*
