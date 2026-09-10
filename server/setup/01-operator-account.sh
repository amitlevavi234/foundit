#!/usr/bin/env bash
# Create the account we will use instead of root.
#
# Sudo is passwordless. That is a deliberate trade, not an oversight: every
# command reaching this machine arrives over SSH with a key, deploys run
# unattended from CI, and nobody can type a password into an automated run.
# The key is the credential; adding a password only where a human happens to
# be watching buys nothing and breaks the deploys.
set -euo pipefail

USERNAME=founditops

id "$USERNAME" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$USERNAME"
usermod -aG sudo "$USERNAME"

# Same key as root, so the account is usable before root is locked.
install -d -m 700 -o "$USERNAME" -g "$USERNAME" "/home/$USERNAME/.ssh"
install -m 600 -o "$USERNAME" -g "$USERNAME" \
  /root/.ssh/authorized_keys "/home/$USERNAME/.ssh/authorized_keys"

echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-$USERNAME
chmod 440 /etc/sudoers.d/90-$USERNAME
visudo -c -q

echo "ok: $(id "$USERNAME")"
