#!/usr/bin/env bash
# Docker, configured so a container cannot expose itself to the internet.
#
# THE PROBLEM THIS SOLVES. Docker writes its own firewall rules, and they are
# consulted before ufw's. Publish a port the ordinary way and it is reachable
# from anywhere on earth while `ufw status` still says "deny (incoming)" and
# means it. That is how self-hosted databases end up publicly readable, often
# within minutes of being started.
#
# Two settings close it:
#   ip                  - the default address for a published port, when none
#                         is given. Covers `docker run -p 5432:5432`.
#   default-network-opts - the same, for user-defined bridge networks, which
#                         is what every Compose project creates. Setting only
#                         `ip` misses Compose entirely, which is the trap
#                         inside the trap.
#
# What we do NOT do is set "iptables": false. Docker's own documentation says
# that leaves ports reachable anyway and breaks outbound networking too.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get install -y -qq ca-certificates curl >/dev/null
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq >/dev/null
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null

mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'CONF'
{
  "ip": "127.0.0.1",
  "default-network-opts": {
    "bridge": {
      "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"
    }
  },
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true,
  "userland-proxy": false
}
CONF

systemctl restart docker
systemctl enable -q docker

# founditops already has passwordless sudo, so group membership grants nothing
# it could not already do — it only removes `sudo` from every compose command.
usermod -aG docker founditops

echo "=== docker ==="; docker --version; docker compose version
echo "=== log limits (a full disk takes down the database, docker AND the monitoring at once) ==="
docker info --format '{{.LoggingDriver}}'
