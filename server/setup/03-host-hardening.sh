#!/usr/bin/env bash
# The host's own firewall, swap, unattended security updates, fail2ban.
#
# Hetzner's cloud firewall already drops everything except SSH from one
# address. This is the second layer, for the case where that is misconfigured
# or a rule is edited by mistake. Two independent things must both be wrong
# before the machine is exposed.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# --- swap ------------------------------------------------------------------
# Not optional on a 4 GB box. Without it, a build or a heavy query gets
# PostgreSQL killed by the kernel and the site goes down for reasons that are
# genuinely hard to diagnose the first time.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# Prefer RAM; use swap as a safety net rather than routine storage.
sysctl -q -w vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.d/99-foundit.conf 2>/dev/null || \
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-foundit.conf

# --- host firewall ---------------------------------------------------------
apt-get install -y -qq ufw >/dev/null
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
# `limit` throttles repeated connection attempts from one address.
ufw limit 22/tcp comment 'ssh' >/dev/null
# Nothing for 80 or 443: the Cloudflare tunnel dials out, so nothing listens.
ufw --force enable >/dev/null

# --- unattended security updates -------------------------------------------
apt-get install -y -qq unattended-upgrades >/dev/null
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/51foundit-unattended <<'CONF'
// Security updates only. Feature updates arrive when we choose, not at 04:30.
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
CONF

# --- fail2ban --------------------------------------------------------------
# On 24.04 there is no /var/log/auth.log, so the systemd backend is required.
# Configured against the file, fail2ban starts happily and watches nothing.
apt-get install -y -qq fail2ban >/dev/null
cat > /etc/fail2ban/jail.d/foundit.conf <<'CONF'
[DEFAULT]
backend = systemd
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
CONF
systemctl enable --now fail2ban >/dev/null 2>&1
systemctl restart fail2ban

echo "=== swap ==="; free -h | grep -i swap
echo "=== firewall ==="; ufw status verbose | head -6
echo "=== fail2ban ==="; fail2ban-client status sshd 2>&1 | head -4
echo "=== unattended-upgrades ==="; systemctl is-enabled unattended-upgrades
