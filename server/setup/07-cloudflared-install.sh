#!/usr/bin/env bash
# Install cloudflared and start the browser authorisation.
#
# A locally managed tunnel: the credential is created on this machine by the
# owner authorising it in a browser, so no token ever travels through a chat
# window or sits in a file we did not write.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if ! command -v cloudflared >/dev/null 2>&1; then
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq >/dev/null
  apt-get install -y -qq cloudflared >/dev/null
fi

cloudflared --version

# Start the login and leave it waiting for the browser. It prints a one-time
# URL; the owner opens it and picks the domain.
rm -f /tmp/cf-login.log
nohup sudo -u founditops cloudflared tunnel login > /tmp/cf-login.log 2>&1 &
sleep 6
echo "=== open this URL ==="
grep -Eo 'https://[^ ]*' /tmp/cf-login.log | head -1
