#!/usr/bin/env bash
# Close SSH down to exactly one account, one method.
#
# Ubuntu 24.04 reads /etc/ssh/sshd_config.d/*.conf BEFORE the main config, and
# SSH takes the first value it sees for each setting, so a file here wins.
#
# The port stays 22. Moving it is theatre — it stops log noise, not attackers —
# and on 24.04 the port lives in the socket unit as well, which is a good way
# to lock yourself out for no security gain.
set -euo pipefail

cat > /etc/ssh/sshd_config.d/99-foundit.conf <<'CONF'
# Only this account may log in, only with a key.
AllowUsers founditops
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthenticationMethods publickey

# Give an attacker less room and less time.
MaxAuthTries 3
MaxSessions 4
LoginGraceTime 20

# Nothing here needs to forward anything.
AllowTcpForwarding no
X11Forwarding no
AllowAgentForwarding no
PermitTunnel no
CONF

chmod 644 /etc/ssh/sshd_config.d/99-foundit.conf

# Refuse to restart with a broken config — this is what stops a typo from
# becoming a machine nobody can reach.
sshd -t

systemctl restart ssh
passwd -l root >/dev/null

echo "ok: ssh restarted, root password locked"
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|allowusers|maxauthtries) '
