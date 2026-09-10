#!/usr/bin/env bash
# Create the tunnel, point the domain at it, and run it as a service.
#
# After this the server needs no inbound ports at all: cloudflared dials out
# to Cloudflare and traffic comes back down that connection. There is nothing
# listening on the public internet to find, scan or attack.
set -euo pipefail

TUNNEL=foundit
CFDIR=/home/founditops/.cloudflared

test -f "$CFDIR/cert.pem" || { echo "not authorised yet: no cert.pem"; exit 1; }

if ! sudo -u founditops cloudflared tunnel list 2>/dev/null | grep -q "\b$TUNNEL\b"; then
  sudo -u founditops cloudflared tunnel create "$TUNNEL"
fi

UUID=$(sudo -u founditops cloudflared tunnel list --output json \
        | python3 -c "import sys,json;print([t['id'] for t in json.load(sys.stdin) if t['name']=='$TUNNEL'][0])")
echo "tunnel id: $UUID"

# Point both names at the tunnel. Proxied automatically — a tunnel route
# cannot be a grey-cloud record, so the origin address stays unpublished.
sudo -u founditops cloudflared tunnel route dns --overwrite-dns "$TUNNEL" foundit.tools
sudo -u founditops cloudflared tunnel route dns --overwrite-dns "$TUNNEL" www.foundit.tools

install -d -m 755 /etc/cloudflared
install -m 600 "$CFDIR/$UUID.json" "/etc/cloudflared/$UUID.json"

cat > /etc/cloudflared/config.yml <<CONF
tunnel: $UUID
credentials-file: /etc/cloudflared/$UUID.json

# Everything reaching the tunnel goes to the application on localhost. The app
# is not built yet, so a placeholder answers until it is.
ingress:
  - hostname: foundit.tools
    service: http://localhost:3000
  - hostname: www.foundit.tools
    service: http://localhost:3000
  - service: http_status:404
CONF

cloudflared service install >/dev/null 2>&1 || true
systemctl enable -q cloudflared 2>/dev/null || true
systemctl restart cloudflared
sleep 4
systemctl is-active cloudflared
