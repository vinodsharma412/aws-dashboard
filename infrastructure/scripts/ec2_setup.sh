#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  EC2 Ubuntu 22.04 — first-boot setup for NSE Stock Dashboard
#
#  Run ONCE on each EC2 (staging account EC2 and prod account EC2).
#  Each EC2 runs exactly one stage — this script sets up /opt/nse/ for it.
#
#  Usage (run inside the EC2 after SSH login):
#    bash ec2_setup.sh
#
#  What it does:
#    1. System packages (Python 3.12, Nginx, Playwright dependencies)
#    2. AWS CLI v2
#    3. /opt/nse/ directory + Python virtualenv
#    4. Playwright Chromium (for Amazon scraper worker)
#    5. Nginx config (proxies /api/ → :9000)
#    6. systemd service files (nse-api, nse-worker)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

echo "========================================="
echo " NSE Stock Dashboard — EC2 Setup"
echo "========================================="

# ── 1. System updates ──────────────────────────────────────────────────────────
echo "[1/7] Updating system packages..."
sudo apt-get update -y -qq
sudo apt-get upgrade -y -qq
sudo apt-get install -y -qq \
  build-essential curl git unzip \
  python3 python3-venv python3-pip \
  nginx \
  fonts-liberation libatk-bridge2.0-0 libatk1.0-0 \
  libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 \
  libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxkbcommon0 \
  libxrandr2 libxshmfence1 xdg-utils
echo "  ✓ System packages installed"

# ── 2. AWS CLI ─────────────────────────────────────────────────────────────────
echo "[2/7] Installing AWS CLI v2..."
if ! command -v aws &>/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp/
  sudo /tmp/aws/install
  rm -rf /tmp/awscliv2.zip /tmp/aws/
fi
aws --version
echo "  ✓ AWS CLI ready"

# ── 3. App directory ──────────────────────────────────────────────────────────
echo "[3/7] Creating /opt/nse directory..."
sudo mkdir -p /opt/nse
sudo chown ubuntu:ubuntu /opt/nse
mkdir -p /opt/nse/backend /opt/nse/logs
echo "  ✓ /opt/nse ready"

# ── 4. Python virtual environment ─────────────────────────────────────────────
echo "[4/7] Creating Python virtual environment..."
if [ ! -d /opt/nse/venv ]; then
  python3 -m venv /opt/nse/venv
  /opt/nse/venv/bin/pip install --upgrade pip wheel -q
  echo "  ✓ venv created: /opt/nse/venv"
else
  echo "  ✓ venv exists: /opt/nse/venv (skipped)"
fi

# ── 5. Playwright ──────────────────────────────────────────────────────────────
echo "[5/7] Installing Playwright + Chromium..."
/opt/nse/venv/bin/pip install playwright -q
/opt/nse/venv/bin/playwright install chromium
/opt/nse/venv/bin/playwright install-deps chromium
echo "  ✓ Playwright installed"

# ── 6. Nginx ──────────────────────────────────────────────────────────────────
echo "[6/7] Configuring Nginx..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
sudo cp "$SCRIPT_DIR/nginx.conf" /etc/nginx/sites-available/nse
sudo ln -sf /etc/nginx/sites-available/nse /etc/nginx/sites-enabled/nse
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx
echo "  ✓ Nginx configured"

# ── 7. Systemd services ────────────────────────────────────────────────────────
echo "[7/7] Installing systemd service files..."

for svc in nse-api nse-worker; do
  src="$SCRIPT_DIR/${svc}.service"
  if [ -f "$src" ]; then
    sudo cp "$src" "/etc/systemd/system/${svc}.service"
    echo "  ✓ Installed: ${svc}.service"
  else
    echo "  ⚠  Missing: ${svc}.service (copy manually)"
  fi
done

sudo systemctl daemon-reload
sudo systemctl enable nse-api nse-worker
echo "  ✓ Services enabled (not started yet — no code deployed)"

echo ""
echo "========================================="
echo " EC2 setup complete!"
echo ""
echo " Next steps:"
echo " 1. Create /opt/nse/.env with STAGE=staging (or prod)"
echo " 2. Deploy code via GitHub Actions or: make deploy EC2_HOST=<ip>"
echo " 3. Start services: sudo systemctl start nse-api nse-worker"
echo " 4. Check logs:     sudo journalctl -u nse-api -f"
echo "========================================="
