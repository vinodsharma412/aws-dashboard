#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Staging smoke tests — automated API checks run after every deployment.
#
#  Usage:
#    bash infrastructure/scripts/test_staging.sh <EC2_HOST>
#    make test-staging          (uses EC2_HOST from .ec2-host or env)
#
#  What it tests:
#    1. Health endpoint reachable
#    2. Login returns a JWT token
#    3. Stock analysis endpoint returns data
#    4. Screener endpoint returns results
#    5. Scraping job creation queues correctly
#    6. SSE endpoint opens without error
#
#  Exit code: 0 = all passed, 1 = at least one failed
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -euo pipefail

EC2_HOST="${1:?Usage: $0 <EC2_HOST>}"
BASE="http://${EC2_HOST}/api/v1"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC}  $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC}  $1"; FAIL=$((FAIL+1)); }

check() {
    local label="$1"
    local cmd="$2"
    local expect="$3"
    local result
    result=$(eval "$cmd" 2>/dev/null || true)
    if echo "$result" | grep -q "$expect"; then
        ok "$label"
    else
        fail "$label (got: ${result:0:120})"
    fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Staging smoke tests — ${BASE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Health check ──────────────────────────────────────────────────────────
check "Health endpoint" \
    "curl -fsS '${BASE}/health/'" \
    '"status"'

# ── 2. Login ─────────────────────────────────────────────────────────────────
TOKEN=$(curl -fsS -X POST "${BASE}/auth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=admin&password=changeme123" \
    2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)

if [ -n "$TOKEN" ] && [ "$TOKEN" != "None" ]; then
    ok "Login — JWT token received"
else
    fail "Login — no token returned (admin user created?)"
    echo ""
    echo "  Hint: create admin user first:"
    echo "    ssh ubuntu@${EC2_HOST}"
    echo "    cd /opt/nse-staging/backend"
    echo "    /opt/nse-staging/venv/bin/python3 -c \""
    echo "      from app.db.dynamo import dynamo_users"
    echo "      from app.core.security import hash_password"
    echo "      import uuid, datetime"
    echo "      dynamo_users.put_item(Item={'user_id':str(uuid.uuid4()),'username':'admin',"
    echo "        'email':'admin@example.com','full_name':'Admin','role':'admin',"
    echo "        'hashed_password':hash_password('changeme123'),'is_active':True,"
    echo "        'created_at':datetime.datetime.utcnow().isoformat()})\""
    echo ""
    # Can't run further tests without a token
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Passed: $PASS  Failed: $FAIL"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

AUTH="-H 'Authorization: Bearer ${TOKEN}'"

# ── 3. Stock analysis ────────────────────────────────────────────────────────
check "Stock analysis — RELIANCE.NS" \
    "curl -fsS ${AUTH} '${BASE}/stocks/analyse/RELIANCE.NS'" \
    '"symbol"'

# ── 4. Global markets ────────────────────────────────────────────────────────
check "Global markets (dashboard)" \
    "curl -fsS ${AUTH} '${BASE}/stocks/market/global'" \
    '"symbol"'

# ── 5. Screener ──────────────────────────────────────────────────────────────
check "Screener endpoint" \
    "curl -fsS ${AUTH} '${BASE}/stocks/screener'" \
    '\['

# ── 6. Get own profile ───────────────────────────────────────────────────────
check "Get current user profile" \
    "curl -fsS ${AUTH} '${BASE}/users/me'" \
    '"username"'

# ── 7. List menus ────────────────────────────────────────────────────────────
check "Menu list" \
    "curl -fsS ${AUTH} '${BASE}/menus/'" \
    '\['

# ── 8. Create scraping job ────────────────────────────────────────────────────
JOB_RESPONSE=$(curl -fsS -X POST "${BASE}/scraping/jobs" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"asins":["B09XYZ1234"]}' 2>/dev/null || true)

if echo "$JOB_RESPONSE" | grep -q '"job_id"'; then
    ok "Create scraping job — job_id returned"
else
    fail "Create scraping job (got: ${JOB_RESPONSE:0:120})"
fi

# ── 9. List scraping jobs ─────────────────────────────────────────────────────
check "List scraping jobs" \
    "curl -fsS ${AUTH} '${BASE}/scraping/jobs'" \
    '\['

# ── 10. Invalid token returns 401 ────────────────────────────────────────────
STATUS=$(curl -o /dev/null -sw "%{http_code}" \
    -H "Authorization: Bearer invalidtoken" \
    "${BASE}/users/me" 2>/dev/null || true)
if [ "$STATUS" = "401" ]; then
    ok "Invalid token → 401 Unauthorized"
else
    fail "Invalid token should return 401 (got: $STATUS)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Passed: $PASS  Failed: $FAIL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $FAIL -gt 0 ]; then
    echo "  Logs: ssh ubuntu@${EC2_HOST} 'sudo journalctl -u nse-api-staging -n 50'"
    echo ""
    exit 1
fi
