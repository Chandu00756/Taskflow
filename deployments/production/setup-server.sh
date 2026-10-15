#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 20.04/22.04/24.04 server (ARM or x86), e.g. an
# Oracle Cloud Always Free instance. Run from the repository checkout:
#
#   sudo bash deployments/production/setup-server.sh
#
# It installs Docker, opens HTTP/HTTPS in the host firewall, creates .env with
# random secrets (asking for your domain and admin email), then builds and
# starts the stack. Safe to run again.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"

if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo: sudo bash $0" >&2
  exit 1
fi

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "Installing Docker and helpers from the Ubuntu repositories"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates openssl curl iptables-persistent unattended-upgrades
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y docker.io
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin
fi
# BuildKit builder (the web image's Dockerfile needs it). Ubuntu 20.04 does
# not pull it in with docker.io.
if ! docker buildx version >/dev/null 2>&1; then
  apt-get install -y docker-buildx || apt-get install -y docker-buildx-plugin || true
fi
systemctl enable --now docker
if [[ -n "${SUDO_USER:-}" ]]; then
  usermod -aG docker "$SUDO_USER" || true
fi

step "Opening ports 80 and 443 in the host firewall"
# Oracle's Ubuntu images ship iptables rules that reject everything except SSH.
for proto_port in "tcp 80" "tcp 443" "udp 443"; do
  set -- $proto_port
  if ! iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null; then
    iptables -I INPUT 1 -p "$1" --dport "$2" -j ACCEPT
  fi
done
netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
fi

step "Adding swap (helps image builds on small machines)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Enabling automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

step "Preparing $ENV_FILE"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$HERE/.env.example" "$ENV_FILE"
  read -rp "Domain for the app [taskflow.portalvii.com]: " domain
  domain="${domain:-taskflow.portalvii.com}"
  read -rp "Your email (certificate notices) : " acme
  read -rp "Super admin email [admin@${domain#*.}]: " admin
  admin="${admin:-admin@${domain#*.}}"
  admin_pw="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)Aa1!"
  sed -i \
    -e "s|^DOMAIN=.*|DOMAIN=${domain}|" \
    -e "s|^ACME_EMAIL=.*|ACME_EMAIL=${acme}|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" \
    -e "s|^SUPER_ADMIN_EMAIL=.*|SUPER_ADMIN_EMAIL=${admin}|" \
    -e "s|^SUPER_ADMIN_PASSWORD=.*|SUPER_ADMIN_PASSWORD=${admin_pw}|" \
    "$ENV_FILE"
  echo "Created $ENV_FILE with random secrets."
  echo "Super admin: ${admin}  (password is in $ENV_FILE — change it after first sign-in)"
else
  echo "$ENV_FILE already exists; keeping it."
fi
chmod 600 "$ENV_FILE"
if grep -Eq '^(POSTGRES_PASSWORD|JWT_SECRET|SUPER_ADMIN_PASSWORD)=change-me' "$ENV_FILE"; then
  echo "Refusing to start: replace the change-me values in $ENV_FILE first." >&2
  exit 1
fi
mkdir -p "$HERE/backups"

domain="$(grep '^DOMAIN=' "$ENV_FILE" | cut -d= -f2)"
server_ip="$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
dns_ip="$(getent ahostsv4 "$domain" | awk 'NR==1{print $1}' || true)"
if [[ "$dns_ip" != "$server_ip" ]]; then
  echo
  echo "Note: $domain resolves to '${dns_ip:-nothing}', but this server is $server_ip."
  echo "HTTPS certificates are issued once DNS points here; Caddy keeps retrying."
fi

step "Building and starting the stack (the first build takes 5-10 minutes)"
cd "$HERE"
docker compose up -d --build
docker image prune -f >/dev/null

step "Done"
echo "Check status:  cd $HERE && docker compose ps"
echo "Follow logs:   cd $HERE && docker compose logs -f caddy api-gateway itsm-service"
echo "Open:          https://$domain"
