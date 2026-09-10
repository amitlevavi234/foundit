#!/usr/bin/env bash
# Prove that a published container port cannot be reached from the internet.
#
# Two cases, because they use different code paths in Docker and the second is
# the one people miss: `docker run -p` uses the default bridge, while every
# Compose project creates a user-defined bridge of its own.
set -euo pipefail

cleanup() {
  docker rm -f fdt_check_default >/dev/null 2>&1 || true
  docker compose -f /tmp/fdt-check.yml down -v >/dev/null 2>&1 || true
  rm -f /tmp/fdt-check.yml
}
trap cleanup EXIT

docker run -d --name fdt_check_default -p 8091:80 nginx:alpine >/dev/null

cat > /tmp/fdt-check.yml <<'YML'
services:
  web:
    image: nginx:alpine
    ports:
      - "8092:80"
YML
docker compose -f /tmp/fdt-check.yml up -d >/dev/null 2>&1

sleep 2
echo "=== what the machine is actually listening on ==="
ss -tlnp 2>/dev/null | grep -E '809[12]' || echo "(nothing listening — unexpected)"

echo
fail=0
for port in 8091 8092; do
  if ss -tln | grep -qE "0\.0\.0\.0:$port|\[::\]:$port"; then
    echo "FAIL: port $port is bound to every interface — it is on the internet"
    fail=1
  elif ss -tln | grep -q "127.0.0.1:$port"; then
    echo "ok: port $port is bound to localhost only"
  else
    echo "?? port $port not found"
    fail=1
  fi
done

echo
echo "=== ufw still says ==="
ufw status | head -2
exit $fail
