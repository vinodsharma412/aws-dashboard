# Interview Preparation — Complete AWS Solution Architecture

## Project Summary (30-second pitch)

"I built a full-stack NSE stock analysis platform with a React frontend,
FastAPI backend, and AWS infrastructure. The React app is hosted on S3 as a
static website. All API calls go through API Gateway which proxies to a FastAPI
server on EC2. User data, portfolios, and scraping jobs are stored in DynamoDB.
Avatar images go to S3. Background jobs like screener pre-computation run as
Lambda functions triggered by EventBridge on a schedule. CloudWatch collects
logs from EC2, API Gateway, and Lambda, and sends alarm emails via SNS when
error rates spike. The entire setup runs within the AWS free tier."

---

## 1. S3 — Simple Storage Service

### What it does in this project
- **Frontend bucket**: Hosts the React build (`index.html`, JS, CSS) as a static website
- **Assets bucket**: Stores avatar images uploaded by users

### How S3 static website works
```
S3 bucket → enable "Static website hosting"
  → Index document: index.html
  → Error document: index.html  (so React Router handles 404s, not S3)
  → Bucket policy: public read on all objects
  → URL: http://bucket-name.s3-website.ap-south-1.amazonaws.com
```

### Interview Q&A

**Q: Why host React on S3 instead of EC2?**
A: S3 is purpose-built for static file serving. It scales infinitely without
managing a server, is globally redundant, and within free tier is $0. EC2 would
waste compute on serving files that don't need a server.

**Q: How does React Router work with S3 static hosting?**
A: S3 only knows about files. If a user navigates to `/stocks/TCS`, S3 returns
404 (no file at that path). Solution: set the error document to `index.html`.
S3 serves index.html for unknown paths → React Router reads the URL → renders
the correct component.

**Q: What is the difference between S3 object URL and website endpoint?**
```
Object URL:   https://bucket.s3.amazonaws.com/index.html   (no routing)
Website URL:  http://bucket.s3-website.region.amazonaws.com (routing + index doc)
```
Website endpoint supports index/error document routing. Object URL is direct
file access. We need the website endpoint for React apps.

**Q: How do you prevent public access to the assets bucket (avatars)?**
A: Keep the assets bucket private. Use either:
1. **Signed URLs**: `s3.generate_presigned_url(...)` — time-limited URL (900s)
2. **EC2 proxy**: FastAPI reads the image from S3 and streams it to the client
In this project we use direct S3 URL with the object set public on upload (simple
for a personal project). Production: use CloudFront with OAC (Origin Access Control).

**Q: What is S3 versioning and why would you enable it?**
A: Versioning keeps every version of every object. If you accidentally overwrite
or delete a file, you can restore it. Disabled here (adds cost) but useful for
production code deployments where you want rollback capability.

---

## 2. EC2 — Elastic Compute Cloud

### What it does in this project
- Runs FastAPI (uvicorn) on port 9000
- Runs Nginx as reverse proxy on port 80 (forwards /api/* to uvicorn)
- Runs the Playwright worker as a systemd service
- t2.micro: 1 vCPU, 1 GB RAM — free tier

### Why EC2 and not Lambda for everything?
```
Playwright (headless Chrome):
  Lambda: max 250 MB package + 512 MB /tmp storage → Playwright EXCEEDS this
  EC2: no limits, installed with playwright install chromium ✅

SSE (Server-Sent Events):
  Lambda: max 29-second integration with API Gateway → connection drops
  EC2: persistent process, connection stays open as long as needed ✅

Worker (continuous polling):
  Lambda: designed for short bursts, not continuous loops
  EC2: systemd keeps the process alive forever ✅
```

### systemd service management
```bash
# Check status
sudo systemctl status nse-api

# View real-time logs
sudo journalctl -u nse-api -f

# Restart after code change
sudo systemctl restart nse-api

# Auto-start on EC2 reboot
sudo systemctl enable nse-api
```

### Interview Q&A

**Q: What is an Elastic IP and why is it needed?**
A: By default, EC2 gets a new public IP every time it restarts. Elastic IP is a
static IP that stays assigned to your account. Without it, every restart would
break API Gateway's integration URL and all DNS records pointing to the server.
Free tier: 1 Elastic IP is free **when associated with a running instance**.
Cost alert: if the instance stops, an unassociated Elastic IP is charged ~$0.005/hr.
Always associate it, or release it if not needed.

**Q: What is an IAM Instance Profile and why use it instead of .env AWS keys?**
A: An Instance Profile attaches an IAM Role to an EC2 instance. The AWS SDK
(boto3) automatically discovers credentials from the instance metadata at
`http://169.254.169.254/latest/meta-data/iam/security-credentials/`.
Hard-coded keys in `.env` are a security risk (accidentally pushed to GitHub,
visible in process list). Instance Profile credentials auto-rotate every hour.

**Q: What is a Security Group?**
A: A virtual firewall controlling inbound/outbound traffic to the instance.
In this project:
```
Inbound:
  Port 22  (SSH)   — My IP only (not 0.0.0.0/0)
  Port 80  (HTTP)  — 0.0.0.0/0 (Nginx, API + SSE)
  Port 443 (HTTPS) — 0.0.0.0/0 (future SSL)
Outbound:
  All traffic — 0.0.0.0/0 (so FastAPI can call yfinance, Bing)
```

**Q: How do you deploy code changes to EC2?**
A: Three methods (increasing sophistication):
1. **scp**: `scp -i key.pem file.py ubuntu@IP:~/nse-backend/app/`
2. **Remote-SSH** (VS Code): edit directly on EC2, then restart service
3. **CI/CD** (GitHub Actions): push to main → action SSHes to EC2 → git pull → restart
Then: `sudo systemctl restart nse-api`

---

## 3. API Gateway

### What it does in this project
- Single HTTPS endpoint for all REST API calls
- Routes `ANY /{proxy+}` to EC2 via HTTP_PROXY integration
- Built-in throttling (20 req/s, 50 burst)
- Built-in CORS headers
- Access logs to CloudWatch

### HTTP API vs REST API
```
Feature              REST API         HTTP API
─────────────────    ────────         ────────
Free tier            No               Yes (1M req/mo)
Latency              ~6 ms overhead   ~1 ms overhead
WebSocket            No               No (use WS API)
JWT authorizer       Yes              Yes
Lambda proxy         Yes              Yes
HTTP proxy (EC2)     Yes              Yes
Cost after free      $3.50/M req      $1.00/M req
```
We use **HTTP API** — cheaper, faster, sufficient for this project.

### The proxy integration pattern
```
Client: GET https://abc123.execute-api.ap-south-1.amazonaws.com/prod/api/v1/stocks/analyse/TCS.NS

API Gateway:
  Route: ANY /{proxy+} matches "api/v1/stocks/analyse/TCS.NS"
  Integration: HTTP_PROXY → http://EC2-IP/{proxy}
  Rewrites URL → http://EC2-IP/api/v1/stocks/analyse/TCS.NS
  Forwards all headers (including Authorization: Bearer JWT)
  Returns response as-is to client

FastAPI:
  Receives GET /api/v1/stocks/analyse/TCS.NS with JWT header
  → normal processing
```

### SSE bypass (critical design decision)
```javascript
// constants.js — two base URLs
export const API_URL = 'https://abc123.execute-api.ap-south-1.amazonaws.com/prod/api/v1';
export const SSE_URL = 'http://EC2-IP/api/v1';  // direct, no API Gateway

// useSSE.js — uses SSE_URL for streaming
const resp = await fetch(`${SSE_URL}${path}`, { headers: { Authorization: ... } });
```
Reason: API Gateway has a hard 29-second integration timeout. An SSE stream
for a scraping job that runs 5 minutes would be killed at 29 seconds.

### Interview Q&A

**Q: What is API Gateway throttling and why enable it?**
A: Throttling limits the request rate to protect the backend.
- **Rate limit (20 req/s)**: steady-state max requests per second
- **Burst limit (50)**: short-term spike allowed above the rate limit
Without throttling, a bot could make 10,000 req/s and crash your EC2 instance
(and generate large yfinance API costs). Free tier: 1M requests/month — throttling
also prevents accidentally exceeding it.

**Q: How does API Gateway handle CORS?**
A: API Gateway can automatically respond to preflight `OPTIONS` requests with
the configured `Access-Control-Allow-*` headers, so FastAPI doesn't need to
handle CORS at all when behind API Gateway. In this project we configure:
```json
AllowOrigins: ["*"]
AllowMethods: ["GET","POST","PUT","DELETE","OPTIONS"]
AllowHeaders: ["Authorization","Content-Type"]
```

**Q: What is an API Gateway stage?**
A: A stage is a named snapshot of the API deployment (like an environment).
Common pattern: `dev`, `staging`, `prod`.
URL format: `https://<api-id>.execute-api.<region>.amazonaws.com/<stage-name>/path`
We use a single `prod` stage with auto-deploy (every change auto-deploys).

**Q: What is the difference between API Gateway and a load balancer (ALB)?**
```
Feature           API Gateway HTTP API    ALB
──────────        ──────────────────      ───
Protocol          HTTP/S                  HTTP/S + TCP + WebSocket
Routing           Path/method/header      Path/host/query/IP
Auth              JWT, IAM, Cognito       None built-in
Rate limiting     Built-in                No
Cost              Per request             Per hour + per LCU
Free tier         Yes (1M req/mo)         No
Lambda target     Yes                     Yes (via ALB)
EC2 target        Yes (HTTP proxy)        Yes (target group)
```
API Gateway is better for API-style request/response workloads. ALB is better
for general-purpose HTTP routing to EC2 fleets.

---

## 4. DynamoDB

### What it does in this project
Replaces PostgreSQL. Stores all application data as key-value + document items.

### Data Model Design

```
Table: nse_users
  PK: user_id (UUID)
  Attributes: username, email, hashed_password, role, is_active, avatar_url
  GSI: username-index → fast login lookup
  GSI: email-index    → duplicate email check

Table: nse_stock_transactions
  PK: txn_id (UUID)
  Attributes: user_id, symbol, quantity, price, transaction_type, total_amount
  GSI: user-transactions-index → portfolio calculation per user

Table: nse_scraping_tasks
  PK: task_id (UUID)
  Attributes: job_id, asin, status, started_at, completed_at, error
  GSI: job-tasks-index  → list tasks for a job
  GSI: status-index     → find pending tasks (worker polling)
```

### Access Patterns vs SQL Queries
```python
# SQL (original):
db.query(User).filter(User.username == "admin").first()

# DynamoDB (AWS version):
dynamo_users.query(
    IndexName="username-index",
    KeyConditionExpression=Key("username").eq("admin"),
    Limit=1,
)["Items"][0]
```

### Interview Q&A

**Q: What is DynamoDB's data model? How does it differ from PostgreSQL?**
```
PostgreSQL (relational):
  Schema enforced — every row has the same columns
  Tables have foreign keys (referential integrity)
  JOINs across tables — single query for related data
  ACID transactions across multiple rows/tables

DynamoDB (NoSQL document):
  Schema-less — each item can have different attributes
  No foreign keys — denormalized data (store everything in one item)
  No JOINs — design your table around your access patterns
  ACID transactions within one table (TransactWriteItems)
```

**Q: What is a GSI (Global Secondary Index) and when do you need one?**
A: DynamoDB queries can only filter by the partition key (and optionally sort key)
of a table or index. A GSI creates an alternate "view" of the table with a different
partition key, so you can query by different attributes.

Example: `nse_users` has PK=`user_id`. To look up by `username`, we need a GSI
with PK=`username`. Without the GSI, we'd have to Scan the entire table (expensive).

**Q: What is the difference between Query and Scan in DynamoDB?**
```
Query:
  Requires a partition key value
  Reads only matching items → efficient → use this always
  Cost: items read × item size

Scan:
  Reads the ENTIRE table
  Then filters (filter happens after reading, not before)
  Expensive for large tables
  When to use: admin list-all-users (small table, infrequent)
```

**Q: What is DynamoDB's free tier?**
A: 25 GB storage, 25 WCU (write capacity units), 25 RCU (read capacity units)
per month, forever (not just 12 months).
- 1 WCU = 1 write of up to 1 KB per second
- 1 RCU = 1 strongly consistent read of up to 4 KB per second
For a dev/personal project with low traffic, 25 RCU/WCU is sufficient.

**Q: What is DynamoDB on-demand billing vs provisioned?**
```
Provisioned:  set fixed WCU/WCU in advance → free tier 25/25 applies
On-demand:    pay per actual request → no free tier → costs money

For free tier: use PROVISIONED billing with 1 WCU + 1 RCU per table
OR use PAY_PER_REQUEST and stay under 25 WCU/RCU free tier equivalent
```
In the create_tables script, we use `PAY_PER_REQUEST` for simplicity,
but stay within free tier by keeping traffic low.

**Q: How do you handle transactions in DynamoDB?**
A: DynamoDB supports `TransactWriteItems` for atomic multi-item operations within
one or two tables. For the scraping job creation:
```python
dynamo.transact_write(TransactItems=[
    {"Put": {"TableName": "nse_scraping_jobs", "Item": job_item}},
    {"Put": {"TableName": "nse_scraping_tasks", "Item": task_1}},
    {"Put": {"TableName": "nse_scraping_tasks", "Item": task_2}},
])
```
All succeed or all fail. But it's limited to 100 items and 2 tables per transaction.

---

## 5. Lambda

### What it does in this project
Background jobs that don't need a persistent process:
- `nse-screener-refresh`: runs every 30 min during market hours
- `nse-universe-refresh`: runs daily at 3 AM IST
- `nse-health-notifier`: triggered by EC2 state-change events

### Lambda execution model
```
EventBridge triggers Lambda
    ↓
Lambda service: spins up execution environment
  - Python 3.12 runtime
  - Loads deployment package (ZIP or container)
  - Cold start: ~1-3 seconds (first invocation after idle)
  - Warm start: <100ms (reuse existing environment)
    ↓
lambda_handler(event, context) called
  - event: the EventBridge scheduled event dict
  - context: metadata (function name, timeout remaining, etc.)
    ↓
Function runs (max 15 min, 512 MB RAM)
  - calls screen_stocks() from packaged stock_service.py
  - writes results to DynamoDB
    ↓
Return dict (statusCode + body)
Logs go to CloudWatch automatically
```

### Interview Q&A

**Q: What is a Lambda cold start?**
A: When Lambda hasn't been invoked recently (typically >15 min idle), the service
must create a new execution environment: pull the runtime, load your package,
initialize global variables. This takes 1-3 seconds.
Warm start (reuse existing container): <100ms.
Mitigation: provisioned concurrency (paid), scheduled ping every 5 min (hack),
smaller package size (faster load).

**Q: What is Lambda's free tier?**
A: 1 million requests/month + 400,000 GB-seconds of compute. Forever (not just 12 months).
Our Lambda functions run a few times/day → well within free tier.

**Q: How do you package a Python Lambda with dependencies?**
```bash
# Method 1: ZIP with dependencies
pip install boto3 yfinance pandas -t ./package/
cp handler.py ./package/
cd package && zip -r ../handler.zip .

# Method 2: Lambda Layers (shared dependencies across functions)
# Method 3: Container image (ECR) — for Playwright which is too large for ZIP
```

**Q: What is the Lambda execution role?**
A: An IAM role that Lambda assumes when it runs. It defines what AWS services
the function can access. Our screener function needs:
- `dynamodb:PutItem` on `nse_screener_cache` table
- `logs:CreateLogGroup`, `logs:PutLogEvents` (automatic for Lambda)

---

## 6. EventBridge

### What it does in this project
- **Scheduler**: trigger Lambda on a cron schedule (screener refresh, universe refresh)
- **Event rules**: react to AWS service events (EC2 stop → alert)
- **Custom events**: FastAPI publishes events (`JobCompleted`) that Lambda consumes

### Pub/Sub pattern explained
```
PUBLISHER               MESSAGE BUS           SUBSCRIBER
─────────               ───────────           ──────────
EventBridge Scheduler   default event bus     Lambda function
(cron expression)   ──► puts event    ──►    subscribes via rule
                                              rule routes event to Lambda

FastAPI endpoint:
events.put_events([{
    "Source": "nse.scraping",
    "DetailType": "JobCompleted",
    "Detail": json.dumps({"job_id": "abc", "status": "done"})
}])
                    ──► default event bus ──► rule: source="nse.scraping"
                                             target: Lambda / SNS / SQS
```

### Interview Q&A

**Q: What is the difference between EventBridge, SNS, and SQS?**
```
EventBridge:
  Content-based routing (filter events by source, detail-type, attributes)
  Many AWS services publish events natively
  Schedule rules (cron)
  Up to 100 targets per rule
  Best for: event routing, orchestration, scheduled jobs

SNS (Simple Notification Service):
  Fan-out (one message → many subscribers)
  Subscribers: Lambda, SQS, HTTP endpoint, email, SMS
  No filtering by content (all subscribers get all messages)
  Best for: notifications, fan-out to multiple consumers

SQS (Simple Queue Service):
  Message queue with guaranteed delivery (retention up to 14 days)
  One consumer pulls and processes each message (not fan-out)
  Dead letter queue for failed messages
  Best for: decoupling, work queues, retry logic
```

**Q: What is the difference between a scheduled rule and an event-pattern rule?**
```
Scheduled rule:
  Trigger: cron(30 21 * * ? *)  or rate(30 minutes)
  No event payload (Lambda gets a synthetic scheduled event)
  Used for: screener refresh, universe download, cleanup jobs

Event-pattern rule:
  Trigger: when an event matches a JSON pattern filter
  {
    "source": ["aws.ec2"],
    "detail-type": ["EC2 Instance State-change Notification"],
    "detail": {"state": ["stopped"]}
  }
  Used for: reacting to EC2 stop, S3 uploads, custom app events
```

---

## 7. CloudWatch

### What it does in this project
- **Logs**: collects FastAPI logs, worker logs, Lambda logs, API Gateway access logs
- **Metrics**: EC2 CPU, DynamoDB consumed capacity, API Gateway latency/errors
- **Alarms**: sends SNS emails when metrics breach thresholds
- **Dashboard**: single view of system health

### Log Groups
```
/nse/api           ← FastAPI stdout (via CloudWatch Agent journald collector)
/nse/worker        ← Playwright worker stdout
/aws/lambda/nse-*  ← Lambda function logs (automatically created)
/aws/apigateway/*  ← API Gateway access logs
```

### Viewing logs in AWS Console
```
CloudWatch → Log groups → /nse/api
  → Log streams → {instance-id}/nse-api
    → Filter events: "ERROR"
    → Time range: last 1 hour
    → Live tail: click "Start" for real-time streaming
```

### CloudWatch Insights (querying logs)
```sql
-- Find all errors in the last hour
SOURCE '/nse/api'
| fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 50

-- Count requests per endpoint
SOURCE '/aws/apigateway/nse-stock-api'
| stats count() by routeKey
| sort by count() desc

-- Find slow requests (>2 seconds)
SOURCE '/nse/api'
| filter @message like /ms\)/
| parse @message "* → * (*ms)" as method, path, duration
| filter duration > 2000
| sort duration desc
```

### Interview Q&A

**Q: What is the CloudWatch Agent and why is it needed on EC2?**
A: EC2 doesn't automatically send logs to CloudWatch. The CloudWatch Agent is a
daemon that runs on EC2 and ships configured log sources to CloudWatch.
It can collect:
- Files: `/var/log/syslog`, application log files
- journald: systemd service logs (nse-api, nse-worker)
- Custom metrics: memory usage, disk usage (EC2 doesn't expose these by default)

**Q: How do you create a metric alarm?**
```
CloudWatch → Alarms → Create Alarm
  → Select metric: AWS/EC2 → CPUUtilization → select instance
  → Set threshold: >= 80 for 1 datapoint (5 min period)
  → Notification: SNS topic → send email
```
In code: `aws cloudwatch put-metric-alarm --alarm-name ...`

**Q: What is a CloudWatch custom metric?**
A: A metric you publish that AWS doesn't collect by default. Examples:
- Memory utilization (EC2 only exposes CPU natively)
- Business metrics: "active scraping jobs", "portfolio value"
```python
cloudwatch.put_metric_data(
    Namespace="NSE/Business",
    MetricData=[{
        "MetricName": "ActiveScrapingJobs",
        "Value": 5,
        "Unit": "Count"
    }]
)
```

---

## 8. IAM — Identity and Access Management

### Roles used in this project

```
NSEStockDashboardEC2Role  (Instance Profile — attached to EC2)
  Permissions:
  - dynamodb: GetItem, PutItem, UpdateItem, DeleteItem, Query, Scan
    on arn:aws:dynamodb:ap-south-1:*:table/nse_*
  - s3: GetObject, PutObject, DeleteObject
    on arn:aws:s3:::nse-assets-*/*

NSELambdaRole  (Lambda execution role)
  Permissions:
  - dynamodb: PutItem on nse_screener_cache
  - logs: CreateLogGroup, CreateLogStream, PutLogEvents

NSEEventBridgeRole  (EventBridge → Lambda)
  Permissions:
  - lambda:InvokeFunction on nse-*
```

### Interview Q&A

**Q: What is the principle of least privilege?**
A: Grant only the minimum permissions needed. Our EC2 role can only access
DynamoDB tables starting with `nse_` and the `nse-assets-*` S3 bucket — it
cannot read other DynamoDB tables, other S3 buckets, or any other AWS service.
Never use `AdministratorAccess` for application roles.

**Q: What is the difference between an IAM User, Role, and Policy?**
```
IAM User:   A person or service with permanent credentials (access key + secret)
            Used for: developers (AWS CLI), CI/CD service accounts

IAM Role:   A set of permissions that can be assumed temporarily
            No permanent credentials — AWS generates short-lived tokens
            Used for: EC2 instances, Lambda, ECS tasks, cross-account access

IAM Policy: A JSON document defining Allow/Deny rules for specific actions
            Attached to Users, Groups, or Roles
            Managed policy: reusable across multiple roles
            Inline policy: attached to one specific role
```

---

## 9. How It All Works Together — End-to-End Flow

### Login Flow
```
1. User: POST /api/v1/auth/token  {username, password}
2. API Gateway: receive request → proxy to EC2
3. EC2 FastAPI:
   a. OAuth2PasswordRequestForm: parse username/password
   b. dynamo_users.query(username-index) → get user item
   c. passlib.verify_password(plain, hashed) → True
   d. create_access_token({"sub": "admin"}) → JWT string
4. Response: {access_token: "eyJhb...", token_type: "bearer"}
5. React: localStorage.setItem("access_token", token)
6. Axios interceptor: adds "Authorization: Bearer eyJhb..." to all future requests
```

### Scraping Job Flow
```
1. User submits ASINs: POST /scraping/jobs [{asins: ["B09G9HD6PD"]}]
2. API Gateway → EC2 FastAPI
3. FastAPI:
   a. Generate job_id = UUID
   b. dynamo_jobs.put_item(Job{status: "pending", total: 1})
   c. Generate task_id = UUID
   d. dynamo_tasks.put_item(Task{asin: "B09G9HD6PD", status: "pending"})
   e. scraping_queue.enqueue(task_id)  → puts on in-memory queue
4. Response: 201 Created → job dict

5. [Background] Worker thread (systemd nse-worker):
   a. Dequeues task_id from queue
   b. dynamo_tasks.update(status="running")
   c. scrape_amazon_asin("B09G9HD6PD"):
      - Playwright launches headless Chromium
      - page.goto("https://www.amazon.in/dp/B09G9HD6PD")
      - Extracts title, price, rating, availability
   d. dynamo_products.put_item(ProductData{asin, title, price, ...})
   e. dynamo_tasks.update(status="completed")

6. [Browser SSE] React useSSE("/scraping/jobs/{job_id}/events"):
   - fetch() → EC2 direct (bypass API Gateway)
   - Reads stream: "data: {pending:0, completed:1}\n\n"
   - Updates UI in real time
```

---

## 10. Debugging Guide

### Where to look when something breaks

| Symptom | Where to look | Command |
|---|---|---|
| API returns 502 | EC2 FastAPI down | `sudo systemctl status nse-api` |
| API returns 503 | Nginx down or EC2 stopped | `sudo systemctl status nginx` |
| Login fails | Wrong password or DynamoDB issue | CloudWatch /nse/api + DynamoDB Console |
| Screener empty | Lambda not running | CloudWatch /aws/lambda/nse-screener-refresh |
| Avatar not uploading | S3 permission or wrong bucket | AWS S3 Console → check bucket name |
| Worker stuck | Task stuck in "running" | DynamoDB → nse_scraping_tasks → scan |
| High CPU alarm | yfinance or Playwright | `top -u ubuntu` on EC2 |
| API Gateway 5xx | FastAPI throwing exception | /nse/api CloudWatch Insights |

### Debug commands on EC2 (SSH in)
```bash
# Real-time API logs
sudo journalctl -u nse-api -f

# Check if FastAPI is running
curl http://localhost:9000/api/v1/docs

# Check Nginx
sudo nginx -t
curl http://localhost:80/health

# DynamoDB item lookup
aws dynamodb get-item \
  --table-name nse_users \
  --key '{"user_id": {"S": "YOUR-UUID"}}'

# Check task status
aws dynamodb query \
  --table-name nse_scraping_tasks \
  --index-name status-index \
  --key-condition-expression "#s = :s" \
  --expression-attribute-names '{"#s": "status"}' \
  --expression-attribute-values '{":s": {"S": "pending"}}'
```

### AWS Console navigation paths
```
DynamoDB items:
  AWS Console → DynamoDB → Tables → nse_users → Explore items

CloudWatch logs:
  AWS Console → CloudWatch → Log groups → /nse/api → Log streams

API Gateway test:
  AWS Console → API Gateway → nse-stock-api → prod → Test

Lambda logs:
  AWS Console → Lambda → nse-screener-refresh → Monitor → View logs in CloudWatch

EventBridge rules:
  AWS Console → EventBridge → Rules → select rule → Monitor tab

EC2 metrics:
  AWS Console → EC2 → Instances → select → Monitoring tab (CPU, network, disk)
```

---

## 11. Key Differences: Original vs AWS Version

| Component | Original (Local) | AWS Version |
|---|---|---|
| Database | PostgreSQL + SQLAlchemy | DynamoDB + boto3 |
| Sessions | `get_db()` generator | No sessions — stateless API calls |
| ORM models | SQLAlchemy Column() | Plain dicts (DynamoDB items) |
| Migrations | Alembic | `create_tables.py` (idempotent) |
| File storage | `/static/avatars/*.jpg` | S3 `nse-assets-*` bucket |
| Frontend | `npm start` (localhost) | S3 static website |
| API entry | Direct to FastAPI | API Gateway → EC2 Nginx → FastAPI |
| Scheduling | None | EventBridge → Lambda |
| Logging | stdout | CloudWatch (via Agent + automatic) |
| Process mgmt | Manual / debugpy | systemd services |
| Credentials | `.env` with all secrets | IAM Instance Profile (no keys) |

---

## 12. Free Tier Safety — What to Watch

```
WARNING: These will cost money if exceeded:

EC2: Stop instance when not using for long periods
  → Unassociated Elastic IP charges ~$0.005/hr when instance stopped
  → Either release the EIP or keep instance running (free if running)

DynamoDB: On-demand billing can exceed 25 WCU/WCU free tier
  → Switch to Provisioned (5 WCU + 5 RCU per table) if you're close

S3: Data transfer OUT charges after 1 GB/month (free tier)
  → Each API response served through EC2 (not S3) doesn't count S3 transfer
  → Frontend static files from S3 website → counted as S3 data transfer

Lambda: 1M requests/month free → our usage is <1K/month, no risk

API Gateway: 1M HTTP API requests/month free → low usage project, no risk

CloudWatch: 5 GB log ingestion/month free
  → Verbose debug logging can fill this. Keep level=INFO in production.
  → Set log retention to 30 days (not indefinite)
```
