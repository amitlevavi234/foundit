# Foundit — Server Hardening for a Self-Hosted Production VPS

**Research date:** 2026-09-10
**Audience:** the owner — not a developer, has never administered a server, working with an AI assistant
**Target setup:** one Hetzner Cloud VPS (CX23 / CX33), Debian 13 or Ubuntu 24.04 LTS, running Next.js + Postgres/pgvector + a reverse proxy in Docker Compose, fronted by Cloudflare

Every claim is sourced inline to primary documentation. Anything I could not verify against a primary source is in [What I could not confirm](#what-i-could-not-confirm) rather than asserted.

---

## 0. The five facts that decide whether this server gets owned

Read these before anything else. The rest of the document is the implementation.

| # | Fact | Consequence |
|---|---|---|
| 1 | **Docker's published ports bypass ufw.** Docker routes container traffic in the `nat` table, so packets are diverted "before it reaches the `INPUT` and `OUTPUT` chains that ufw uses." ([Docker: Docker and ufw](https://docs.docker.com/engine/network/packet-filtering-firewalls/)) | `ufw status` can say `deny` and your Postgres is still open to the internet. This is section 2 and it is the centrepiece. |
| 2 | **Docker publishes to `0.0.0.0` by default.** Docker's own docs call this "insecure by default. Meaning, when you publish a container's ports it becomes available not only to the Docker host, but to the outside world as well." ([Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)) | `ports: - "5432:5432"` in a compose file is a public database. |
| 3 | **A Cloudflare-fronted site with an unrestricted origin IP is not protected.** Cloudflare: "block all traffic that does not come from Cloudflare IP addresses." ([Cloudflare IP addresses](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/)) | The WAF, rate limiting and DDoS protection are all optional from the attacker's point of view until the origin refuses non-Cloudflare traffic. |
| 4 | **Hetzner Cloud Firewalls block all inbound by default and are free.** "all inbound traffic will automatically be blocked" without rules; "all outbound traffic will automatically be permitted." ([Hetzner: Cloud Firewalls](https://docs.hetzner.com/cloud/firewalls/overview/)) | This is the one firewall Docker cannot bypass, because it is not on the machine. It is your safety net for fact #1. |
| 5 | **You will lock yourself out of SSH.** | Hetzner's web console and Rescue system are the way back in ([Hetzner: Using the console](https://docs.hetzner.com/cloud/servers/getting-started/vnc-console/), [Using Rescue](https://docs.hetzner.com/cloud/servers/getting-started/rescue-system/)). Read §1.9 *before* you need it. |

**The single most important line of configuration in this entire document:**

```yaml
# In docker-compose.yml — Postgres must NEVER be published to the host's public address
ports:
  - "127.0.0.1:5432:5432"    # correct — loopback only
# NOT: - "5432:5432"          # this is 0.0.0.0:5432 — public
```

Better still: **delete the `ports:` block from Postgres entirely.** Containers on the same Docker Compose network reach each other by service name without any port being published to the host at all.

---

## 1. First hour: the setup runbook, in exact order

Do these in order. Steps 1.1–1.4 happen before you have ever touched the machine; do not skip ahead.

### 1.1 Generate an SSH key on your own computer (before creating the server)

On your laptop — **not** on the server.

```bash
# macOS / Linux / Windows PowerShell (OpenSSH is built into Windows 10+)
ssh-keygen -t ed25519 -a 100 -C "foundit-owner-$(date +%Y%m)" -f ~/.ssh/foundit_ed25519
```

- `-t ed25519` — modern, short, fast. Use `-t rsa -b 4096` only if something refuses ed25519.
- Set a **passphrase** when prompted. If your laptop is stolen, the passphrase is the only thing between the thief and the server.
- This creates two files: `~/.ssh/foundit_ed25519` (private — never leaves your laptop, never pasted anywhere) and `~/.ssh/foundit_ed25519.pub` (public — this is the one you upload).

Print the public key to paste into Hetzner:

```bash
cat ~/.ssh/foundit_ed25519.pub
```

**Back up the private key now**, before you go further — to a password manager's secure-file storage or an encrypted USB stick. If you lose it before step 1.5 you are doing a rescue boot on day one.

### 1.2 Create the server with the SSH key, never a password

In the Hetzner Console: **Servers → Add Server** ([Hetzner: Creating a server](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/)).

| Setting | Choose | Why |
|---|---|---|
| Location | Nuremberg / Falkenstein / Helsinki (EU) or Ashburn/Hillsboro (US) | Closest to your users; EU locations matter if you have EU personal data. |
| Image | **Ubuntu 24.04 LTS** or **Debian 13** | Both get 5 years (Ubuntu LTS) / ~5 years (Debian LTS) of security updates. Ubuntu 24.04 LTS is the safer default for a first-timer: more Docker documentation matches it, and `unattended-upgrades` is preinstalled and enabled. |
| Type | CX23 (2 vCPU / 4 GB) to start, CX33 (4 vCPU / 8 GB) if pgvector indexes are large | Shared vCPU is fine for this workload. Resizing up later is a reboot. |
| Networking | **Public IPv4: yes. Public IPv6: yes** (or disable IPv6 entirely if you will not firewall it — see §2.7) | You need IPv4 for Cloudflare. IPv6 is the most commonly *forgotten* half of a firewall. |
| SSH keys | **Paste the public key from step 1.1** | This is the whole point. |
| Firewalls | Attach the firewall from §2.2 — **create it first, in a separate tab** | Attaching at creation means the box is never naked on the internet. |
| Backups | **Enable** (+20% of server cost) | See §7. This is the cheapest insurance you will ever buy. |
| Cloud config | Optional — see §1.10 for a cloud-init that does steps 1.5–1.8 automatically | |

Critical Hetzner behaviour: **"After the server has been created, it is no longer possible to add an SSH key via the Hetzner Console"** ([Hetzner: Creating a server](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/)). Adding a second key later is done over SSH or from Rescue. Add every key you might want **at creation time** — including one from a second device.

Because you supplied an SSH key, Hetzner does not email you a root password. That is correct and desirable.

### 1.3 First login as root

```bash
ssh -i ~/.ssh/foundit_ed25519 root@YOUR.SERVER.IP
```

If you get "Permission denied (publickey)": you pasted the wrong key, or you pasted the *private* key. Do not "fix" this by resetting the root password — go back and check.

Record the host key fingerprint shown on first connect. If it ever changes without you rebuilding the server, stop and investigate.

### 1.4 Update everything, immediately

```bash
apt update && apt full-upgrade -y
apt install -y sudo curl ca-certificates gnupg ufw fail2ban unattended-upgrades apt-listchanges needrestart
reboot
```

Wait ~30 seconds and reconnect. A freshly created image is usually weeks old; there are almost always pending security fixes.

### 1.5 Create the non-root sudo user

```bash
# Choose a name that is not "admin", "ubuntu", "deploy" or your app name — those are guessed.
adduser founditops                    # sets a strong password; you will rarely type it
usermod -aG sudo founditops           # Ubuntu/Debian: the "sudo" group grants full sudo
```

Give it your SSH key (this copies root's `authorized_keys`, which Hetzner populated):

```bash
rsync --archive --chown=founditops:founditops ~/.ssh /home/founditops/
chmod 700 /home/founditops/.ssh
chmod 600 /home/founditops/.ssh/authorized_keys
```

**Why the user has a password at all:** `sudo` will prompt for it. That password is a second factor against a stolen SSH key — an attacker with your key but not your password can read files but cannot trivially become root. Store it in your password manager. Do **not** configure `NOPASSWD` sudo.

### 1.6 Prove the new user works — in a second terminal, before you break anything

This is the step people skip and it is the step that saves them.

**Leave your root SSH session open.** Open a *new* terminal window and run:

```bash
ssh -i ~/.ssh/foundit_ed25519 founditops@YOUR.SERVER.IP
sudo whoami          # must print: root
```

If both of those work, and only then, continue. If either fails, fix it from the still-open root session.

### 1.7 Harden sshd

Modern Debian/Ubuntu `sshd_config` ends with an `Include /etc/ssh/sshd_config.d/*.conf` line, and `Include` files are processed in lexical order with **first-obtained-value-wins** semantics ([sshd_config(5)](https://man.openbsd.org/sshd_config)). Because includes are at the *top* of the effective config on these distros, a drop-in file overrides the main file. Write a drop-in rather than editing the shipped file — package upgrades will not fight you.

```bash
sudo tee /etc/ssh/sshd_config.d/99-foundit-hardening.conf > /dev/null <<'EOF'
# --- Foundit SSH hardening ---
# Authentication
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
AuthenticationMethods publickey

# Who may log in at all
AllowUsers founditops

# Brute-force surface
MaxAuthTries 3
MaxSessions 4
LoginGraceTime 20

# Reduce what a compromised session can do
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitTunnel no
PermitUserEnvironment no

# Drop dead sessions
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
```

Why each line matters, against the OpenSSH defaults ([sshd_config(5)](https://man.openbsd.org/sshd_config)):

| Directive | OpenSSH default | Set to | Reason |
|---|---|---|---|
| `PermitRootLogin` | `prohibit-password` | `no` | Removes the one username every scanner already knows. `prohibit-password` is already decent; `no` is strictly better and costs nothing since you have a sudo user. |
| `PasswordAuthentication` | **`yes`** | `no` | The default is the reason password-guessing bots exist. This single line eliminates the entire brute-force attack class. |
| `KbdInteractiveAuthentication` | **`yes`** | `no` | The back door around `PasswordAuthentication no` on some PAM configurations. Turning off one without the other is a classic half-fix. |
| `PermitEmptyPasswords` | `no` | `no` | Already safe; stated explicitly so a future edit cannot silently change it. |
| `MaxAuthTries` | `6` | `3` | Fewer guesses per TCP connection; also makes fail2ban's counting cleaner. |
| `LoginGraceTime` | `120` seconds | `20` | Caps how many half-open unauthenticated sessions can be held. Also reduces exposure to pre-auth resource exhaustion. |
| `AllowTcpForwarding` | **`yes`** | `no` | Stops a stolen key being used to tunnel into your internal Docker network or your loopback-bound Postgres. **This is not cosmetic** — with `AllowTcpForwarding yes`, `ssh -L 5432:127.0.0.1:5432` reaches the database you carefully bound to loopback. |
| `X11Forwarding` | `no` | `no` | Stated explicitly; some distro configs turn it on. |
| `AllowUsers` | all users | `founditops` | Any future service account created by a package cannot be logged into. |

Validate **before** restarting — a syntax error here plus a restart equals a locked-out server:

```bash
sudo sshd -t && echo "CONFIG OK"
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauth|kbdinteractive|allowusers|^port|maxauthtries'
```

`sshd -T` prints the *effective* merged configuration. Trust it over what you think you wrote.

Then, with your existing session still open:

```bash
sudo systemctl restart ssh     # Ubuntu 24.04/Debian 13: the unit is "ssh"; on some systems "sshd"
```

**Open a third terminal and log in again before closing anything.** Existing SSH sessions survive a restart of the daemon; that is what gives you a second chance.

### 1.8 Disable the root account's password entirely

Hetzner's "Reset root password" (§1.9) sets one when you need it, so locking it now costs nothing:

```bash
sudo passwd -l root      # locks the password; does not disable the account
```

### 1.9 SSH on a non-standard port: worth it, or theatre?

**Verdict: it is theatre against a targeted attacker, and genuinely useful against the noise. Given this specific setup, do it — but only for the log-hygiene reason, and never as a substitute for key-only auth.**

The honest argument on both sides:

**Against (it is theatre):**
- Any full-port scan finds it. `nmap -sS -p- <ip>` takes minutes and mass-scanners like ZMap sweep the entire IPv4 internet on all ports routinely. Moving to port 2222 or 62222 does not hide you from anyone who is actually looking at *you*.
- It is the textbook definition of security through obscurity: the CIS Benchmarks and OpenSSH's own documentation harden SSH by removing password auth and restricting users, not by moving the port.
- It adds a permanent operational cost: every `ssh`, `scp`, `rsync` and `ansible` invocation needs the port, and the day you forget it is the day you think you are locked out.
- Ports above 1024 are unprivileged. If sshd ever crashed and did not restart, an unprivileged local user could in principle bind the port. (Marginal on a single-admin box, but it is a real difference from port 22.)

**For (it is useful, just not as "security"):**
- The overwhelming majority of SSH attack traffic is undirected bots hammering port 22 with credential lists. Moving off 22 removes roughly all of it. Your `auth.log` goes from thousands of lines a day to approximately zero.
- That matters *because of what it enables*: with a quiet log, a single failed login is a signal you can actually notice. On port 22, real signal is buried in noise, and nobody reads the log, and so nobody notices anything ever.
- It reduces fail2ban's workload and your log storage, which on a 2-vCPU box is not nothing.

So: change the port, and be clear with yourself that you did it for **signal-to-noise**, not for protection. The protection came from `PasswordAuthentication no`.

If you do it:

```bash
# 1. Add the port to the SSH drop-in — keep 22 temporarily so you cannot lock yourself out
sudo tee -a /etc/ssh/sshd_config.d/99-foundit-hardening.conf > /dev/null <<'EOF'

Port 22
Port 52242
EOF

# 2. On Ubuntu 24.04+ and Debian 13, sshd is socket-activated by systemd.
#    The "Port" directive in sshd_config is IGNORED unless you also change the socket.
sudo systemctl edit ssh.socket
# In the editor, add:
#   [Socket]
#   ListenStream=
#   ListenStream=22
#   ListenStream=52242

# 3. Open the new port in BOTH firewalls before restarting (see §2)
sudo ufw allow 52242/tcp comment 'ssh-new'
#    ...and add it to the Hetzner Cloud Firewall in the Console.

# 4. Restart and TEST FROM A NEW TERMINAL
sudo systemctl daemon-reload && sudo systemctl restart ssh.socket ssh
ssh -p 52242 -i ~/.ssh/foundit_ed25519 founditops@YOUR.SERVER.IP

# 5. ONLY after the new port works: remove "Port 22", remove it from ssh.socket,
#    remove it from ufw and from the Hetzner firewall.
```

The socket-activation trap in step 2 is the single most common reason "I changed the port and SSH still answers on 22" — on socket-activated systems the `Port` line in `sshd_config` is not what binds the listener. Verify with:

```bash
sudo ss -tlnp | grep -E 'sshd|systemd'
```

Save the connection details somewhere you will find them in a panic. A one-line `~/.ssh/config` entry on your laptop removes the "what port was it?" failure mode entirely:

```
Host foundit
    HostName YOUR.SERVER.IP
    User founditops
    Port 52242
    IdentityFile ~/.ssh/foundit_ed25519
    IdentitiesOnly yes
```

Then you just type `ssh foundit`.

### 1.10 How you avoid locking yourself out — and the way back in when you do

**The four rules that prevent lockout:**

1. **Never close your working SSH session while changing SSH, firewall, or network configuration.** Open a *second* session and verify. Only then close the first. This one rule prevents most lockouts.
2. **Run `sudo sshd -t` before every `systemctl restart ssh`.** It refuses to be clever; it just tells you the config parses.
3. **Change one firewall at a time.** Never edit the Hetzner Cloud Firewall and ufw in the same minute.
4. **Use a "dead man's switch" for genuinely risky changes.** Before applying a firewall rule you are unsure about, schedule an automatic rollback:

```bash
# Reverts the firewall in 10 minutes unless you cancel it
sudo bash -c 'echo "ufw --force reset && ufw --force enable && ufw allow 52242/tcp && ufw allow 80,443/tcp" | at now + 10 minutes'
# ...apply your risky change, confirm you still have access, then:
sudo atrm $(sudo atq | awk '{print $1}')     # cancel the rollback
```

(`sudo apt install at` first.) A simpler variant for ufw specifically: `sudo timeout 600 sh -c 'sleep 590; ufw disable'` in a detached `screen`.

**The way back in — Hetzner's console and Rescue, in escalating order:**

**Path A — Web/VNC console (fixes: bad firewall rule, bad sshd config, wrong port).**
This is a virtual monitor and keyboard attached to the running machine. It does not use the network, so no firewall rule can block it.

1. Hetzner Console → your server → the console icon at the top right ([Hetzner: Using the console](https://docs.hetzner.com/cloud/servers/getting-started/vnc-console/)).
2. You need a password to log in. If you locked root's password in §1.8 and forgot your `founditops` password: server → **Rescue** → **Root password** → **Reset root password**. "Your new password will appear directly in the Hetzner Console" ([Hetzner: Using the console](https://docs.hetzner.com/cloud/servers/getting-started/vnc-console/)). Note this **reboots the server**.
3. Log in and fix the thing:
   ```bash
   ufw disable                                   # undo a firewall lockout
   rm /etc/ssh/sshd_config.d/99-foundit-hardening.conf   # undo a bad sshd config
   sshd -t && systemctl restart ssh
   ss -tlnp | grep ssh                           # confirm what port it is really on
   ```
   Note: the password you type is not echoed — "your password will not be visible in the console" ([Hetzner: Using the console](https://docs.hetzner.com/cloud/servers/getting-started/vnc-console/)). That is normal, not a broken keyboard.

**Path B — Rescue system (fixes: server will not boot, filesystem damage, lost key with no working login).**
This netboots a separate Linux with your disk unmounted, so you can repair anything.

1. Server → **Rescue** → **Enable rescue & power cycle**; choose `linux64` and, if you have a working SSH key, select it ([Hetzner: Using Rescue](https://docs.hetzner.com/cloud/servers/getting-started/rescue-system/)).
2. "Rescue remains activated for 60 minutes" — if you do not reboot inside that window it deactivates itself and the server boots normally again. After the first boot into rescue, "rescue will remain active until you restart the server again" ([Hetzner: Using Rescue](https://docs.hetzner.com/cloud/servers/getting-started/rescue-system/)).
3. `ssh root@YOUR.SERVER.IP`. The host key differs from your normal system, so clear the old one first:
   ```bash
   ssh-keygen -f ~/.ssh/known_hosts -R YOUR.SERVER.IP
   ```
   (Hetzner documents exactly this ([Using Rescue](https://docs.hetzner.com/cloud/servers/getting-started/rescue-system/)).)
4. Mount your real disk and repair it:
   ```bash
   lsblk                          # find the root partition, usually /dev/sda1
   mount /dev/sda1 /mnt
   # Add a key you still hold:
   nano /mnt/root/.ssh/authorized_keys
   # Or undo the config that locked you out:
   rm /mnt/etc/ssh/sshd_config.d/99-foundit-hardening.conf
   # Or disable ufw at boot:
   rm /mnt/etc/systemd/system/multi-user.target.wants/ufw.service
   umount /mnt
   ```
5. **Reboot to leave rescue.** "The only way to end Rescue is to restart the server once again" ([Hetzner: Using Rescue](https://docs.hetzner.com/cloud/servers/getting-started/rescue-system/)).

Hetzner Rescue does not include mount instructions on its own page — steps 4's commands are standard Linux, not Hetzner-documented; see [What I could not confirm](#what-i-could-not-confirm).

**Path C — Snapshot rollback.** If you took a snapshot before the change (you should have, see §7.4), restoring it is a few clicks and about a minute. Cheapest recovery of all.

### 1.11 Optional: do steps 1.4–1.8 automatically with cloud-init

Hetzner accepts a cloud-init file at creation time (limit 32 KB, [Creating a server](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/)). This closes the window in which the server sits on the internet with default settings.

```yaml
#cloud-config
users:
  - name: founditops
    groups: [sudo]
    shell: /bin/bash
    lock_passwd: false
    # Generate with: mkpasswd --method=SHA-512 --rounds=4096
    passwd: "$6$REPLACE_WITH_YOUR_OWN_HASH"
    ssh_authorized_keys:
      - "ssh-ed25519 AAAA... your-public-key-here"

package_update: true
package_upgrade: true
packages: [ufw, fail2ban, unattended-upgrades, curl, ca-certificates, gnupg]

write_files:
  - path: /etc/ssh/sshd_config.d/99-foundit-hardening.conf
    permissions: '0644'
    content: |
      PermitRootLogin no
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PubkeyAuthentication yes
      PermitEmptyPasswords no
      AllowUsers founditops
      MaxAuthTries 3
      LoginGraceTime 20
      X11Forwarding no
      AllowAgentForwarding no
      AllowTcpForwarding no

runcmd:
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp
  - ufw --force enable
  - passwd -l root
  - sshd -t && systemctl restart ssh
```

Keep port 22 in the cloud-init. Change the port later, interactively, when you can test it.

---

## 2. The two firewalls, and the trap between them

### 2.1 The mental model

You have **three** packet-filtering layers, and they do not see the same packets:

```
   Internet
      â”‚
      â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  LAYER 1 â€” Hetzner Cloud Firewall                        â”‚
â”‚  Runs OUTSIDE your machine, on Hetzner's network.        â”‚
â”‚  Docker cannot touch it. You cannot lock yourself out of â”‚
â”‚  the console with it. Default: deny all inbound.         â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                        â”‚  packets that survive
                        â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  YOUR SERVER'S KERNEL â€” netfilter                        â”‚
â”‚                                                          â”‚
â”‚   raw/PREROUTING  â†’  nat/PREROUTING (Docker's DNAT)      â”‚
â”‚                            â”‚                             â”‚
â”‚            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”              â”‚
â”‚            â–¼                              â–¼              â”‚
â”‚   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚   â”‚ LAYER 2a: filter â”‚         â”‚ LAYER 2b: filter      â”‚ â”‚
â”‚   â”‚ INPUT chain      â”‚         â”‚ FORWARD chain         â”‚ â”‚
â”‚   â”‚ -- ufw lives hereâ”‚         â”‚ -- DOCKER-USER first, â”‚ â”‚
â”‚   â”‚                  â”‚         â”‚    then Docker's own  â”‚ â”‚
â”‚   â”‚ Traffic to the   â”‚         â”‚    chains             â”‚ â”‚
â”‚   â”‚ HOST: sshd, and  â”‚         â”‚ Traffic to CONTAINERS â”‚ â”‚
â”‚   â”‚ anything bound   â”‚         â”‚ via published ports   â”‚ â”‚
â”‚   â”‚ to the host      â”‚         â”‚                       â”‚ â”‚
â”‚   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚           â–²                              â–²               â”‚
â”‚           â”‚                              â”‚               â”‚
â”‚      ufw protects this        ufw DOES NOT protect this  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

That right-hand branch is the trap. Everything in Â§2.4 is about it.

### 2.2 Layer 1 â€” the Hetzner Cloud Firewall (do this first)

This is your safety net, precisely *because* it is not on the machine. Docker cannot bypass it, a mistake in it cannot lock you out of the web console, and it is free ([Hetzner: Cloud Firewalls](https://docs.hetzner.com/cloud/firewalls/overview/)).

Hetzner Cloud Firewalls "block any network traffic not specified in a rule": without rules, "all inbound traffic will automatically be blocked" and "all outbound traffic will automatically be permitted" ([Hetzner: Cloud Firewalls](https://docs.hetzner.com/cloud/firewalls/overview/)).

**Create it in the Console â†’ Firewalls â†’ Create Firewall**, then attach it to the server.

| Direction | Protocol | Port | Source | Comment |
|---|---|---|---|---|
| Inbound | TCP | `52242` (or `22`) | **your home/office IPv4 /32 only**, e.g. `203.0.113.45/32` | SSH. If your ISP gives you a dynamic address, use `0.0.0.0/0` **and** rely on key-only auth + fail2ban â€” but prefer a fixed source if you have one. |
| Inbound | TCP | `80` | Cloudflare IPv4 ranges (Â§3.2) | HTTP â†’ redirect to HTTPS, and ACME HTTP-01 if you use it |
| Inbound | TCP | `443` | Cloudflare IPv4 ranges (Â§3.2) | HTTPS |
| Inbound | ICMP | â€” | `0.0.0.0/0` (optional) | Ping. Useful for monitoring; harmless. |
| Outbound | â€” | â€” | leave default (allow all) | Restricting egress on a box that pulls Docker images, apt packages and calls an embeddings API is more pain than value at this scale. See Â§2.8. |

Limits you will not hit but should know: 5 firewalls per server, 500 effective rules per firewall, 80,000 concurrent connections per server ([Hetzner: Cloud Firewalls](https://docs.hetzner.com/cloud/firewalls/overview/)).

**Three Hetzner behaviours that surprise people:**

1. **Rule changes do not kill existing connections.** "the new settings apply only to new connection attempts. Existing connections established before the Firewall was updated will remain active" ([Hetzner: Firewall FAQ](https://docs.hetzner.com/cloud/firewalls/faq/)). Good news when you lock yourself out mid-session â€” your SSH stays up long enough to undo it. Bad news when testing: your "it still works!" may just be an old connection. **Test from a fresh connection, ideally from a different network.**
2. **Private networks are not filtered.** "Not yet, because we consider the private networks to be 'secure'" ([Hetzner: Firewall FAQ](https://docs.hetzner.com/cloud/firewalls/faq/)). If you ever add a second server on a Hetzner private network, the Cloud Firewall will not police traffic between them â€” only the host firewall will.
3. **Some Hetzner services always bypass the firewall** â€” DNS, the rescue system, the metadata server and DHCP ([Hetzner: Firewall FAQ](https://docs.hetzner.com/cloud/firewalls/faq/)). This is why the console/rescue path in Â§1.10 always works no matter how badly you misconfigure things.

### 2.3 Layer 2a â€” the host firewall with ufw

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw default deny routed          # explicit: do not forward by default

sudo ufw limit 52242/tcp comment 'ssh rate-limited'
# Or, tighter, if you have a static home IP:
# sudo ufw allow from 203.0.113.45/32 to any port 52242 proto tcp comment 'ssh from home'

# 80/443 are added in Â§3.3, restricted to Cloudflare. Do NOT open them to the world here.

sudo ufw logging low
sudo ufw --force enable
sudo ufw status verbose
```

`ufw` places its rules in the `INPUT` and `FORWARD` chains ([ufw(8)](https://manpages.ubuntu.com/manpages/noble/man8/ufw.8.html)). Note the second half of that sentence â€” it *does* write FORWARD rules. That is exactly why the next section is confusing: ufw's FORWARD rules are appended *after* Docker's jump to its own chains, so Docker's ACCEPT wins first.

`ufw limit` denies a source that makes 6 or more connections in 30 seconds â€” free brute-force damping before fail2ban even starts.

### 2.4 THE TRAP: Docker publishes straight past ufw

**This is the single most common way a self-hosted database ends up publicly readable. Read this section twice.**

#### 2.4.1 What actually happens

Docker's documentation states it plainly:

> "Docker and ufw use firewall rules in ways that make them incompatible with each other. When you publish a container's ports using Docker, traffic to and from that container gets diverted before it goes through the ufw firewall settings. Docker routes container traffic in the `nat` table, which means that packets are diverted before it reaches the `INPUT` and `OUTPUT` chains that ufw uses."
> â€” [Docker: Packet filtering and firewalls â†’ Docker and ufw](https://docs.docker.com/engine/network/packet-filtering-firewalls/)

Mechanically:

1. A packet arrives for `YOUR.SERVER.IP:5432`.
2. `nat/PREROUTING` â†’ Docker's `DOCKER` chain **DNATs** the destination to the container's private address, e.g. `172.18.0.3:5432`.
3. Because the destination is no longer the host itself, the packet is now **forwarded**, not delivered locally. It goes to the `FORWARD` chain â€” *not* `INPUT`.
4. Docker inserts, at the top of `FORWARD`, unconditional jumps to `DOCKER-USER`, `DOCKER-FORWARD` and `DOCKER-INGRESS` ([Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/)). `DOCKER-FORWARD`/`DOCKER` accept the packet, because you published the port.
5. ufw's rules â€” which sit in `INPUT`, and in `FORWARD` *after* Docker's jumps â€” are never consulted. Docker's own words: *"Packets that get accepted or rejected by rules in these custom chains will not be seen by user-defined rules appended to the `FORWARD` chain"* ([Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/)).

The result: `ufw status` says `Status: active`, `Default: deny (incoming)`, and Postgres is answering the internet.

Compounding it, Docker's default publish address is every address on the host. Docker's own words: publishing is *"insecure by default. Meaning, when you publish a container's ports it becomes available not only to the Docker host, but to the outside world as well"* ([Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)).

**In one sentence:** ufw filters packets addressed *to the host*; Docker's published ports are addressed *through the host to a container*, take a different path through the kernel, and are accepted by rules Docker wrote before ufw's are ever reached.

#### 2.4.2 How to detect it â€” five checks, in ascending order of trustworthiness

**Check 1 â€” what is Docker actually publishing?**

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

Read the left-hand side of each `->`. Anything reading `0.0.0.0:5432->5432/tcp` or `:::5432->5432/tcp` is **published to the whole internet**. Only `127.0.0.1:5432->5432/tcp` is safe.

**Check 2 â€” what is listening on the host, and on which address?**

```bash
sudo ss -tlnp
```

In the `Local Address:Port` column:
- `127.0.0.1:5432` â€” loopback only. Safe.
- `0.0.0.0:5432`, `*:5432` or `[::]:5432` â€” **exposed**. The process will be `docker-proxy` (or nothing at all if `userland-proxy: false`, in which case Check 3 is the authority).

**Check 3 â€” read Docker's rules directly.**

```bash
sudo iptables -t nat -L DOCKER -n --line-numbers
sudo iptables -L DOCKER -n --line-numbers
sudo iptables -L DOCKER-USER -n --line-numbers
```

A `DNAT ... to:172.x.x.x:5432` with no source restriction, and an empty `DOCKER-USER` chain, is the exposure spelled out in full.

**Check 4 â€” grep the compose file for the anti-pattern.**

```bash
grep -nE '^\s*-\s*"?[0-9]+:[0-9]+' docker-compose.yml
```

Every hit is a port published on `0.0.0.0`. Each one needs either a `127.0.0.1:` prefix or deletion.

**Check 5 â€” the only check that proves anything: scan from outside.** See Â§5 (Verification). Checks 1â€“4 tell you what the machine *intends*. Only an external scan tells you what the internet *sees*.

#### 2.4.3 The correct fixes, in the order to apply them

**Fix 1 (always) â€” do not publish what does not need publishing.**

Containers on the same Compose network reach each other by service name over the Docker network, with no host port involved at all. Your app reaches Postgres at `db:5432` whether or not a host port exists.

```yaml
services:
  db:
    image: pgvector/pgvector:pg17
    # NO ports: block at all. This is the correct configuration.
    networks: [backend]

  app:
    image: foundit-app
    environment:
      DATABASE_URL: postgres://foundit:${DB_PASSWORD}@db:5432/foundit   # resolved over the Docker network
    networks: [backend, frontend]

  caddy:
    image: caddy:2
    ports:
      - "0.0.0.0:80:80"     # deliberately public â€” restricted to Cloudflare by firewall, Â§3
      - "0.0.0.0:443:443"
    networks: [frontend]

networks:
  frontend:
  backend:
    internal: true          # containers here have NO route to the internet at all
```

`internal: true` on the backend network means the database container cannot make outbound connections either, which blunts a large class of post-exploitation activity (exfiltration, pulling a second-stage payload, joining a botnet).

**Fix 2 (always) â€” when you must publish, bind to loopback.**

```yaml
    ports:
      - "127.0.0.1:5432:5432"
```

Docker documents exactly this pattern: `docker run -p 127.0.0.1:8080:80 -p '[::1]:8080:80' nginx` ([Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)). **Note the IPv6 half** â€” `127.0.0.1:5432:5432` binds only IPv4 loopback.

Docker also notes a version floor worth knowing: **Docker versions before 28.0.0 allowed hosts on the same L2 segment to reach localhost-published ports** ([Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)). Run Docker Engine 28.0 or newer; check with `docker version`.

To reach a loopback-bound Postgres from your laptop:

```bash
ssh -L 5432:127.0.0.1:5432 foundit
# then point a local psql / TablePlus at localhost:5432
```

âš ï¸ **That tunnel needs `AllowTcpForwarding yes`, which Â§1.7 deliberately turned off.** Pick one:
- **Recommended:** leave forwarding off entirely and use `docker exec -it db psql -U foundit foundit` inside a normal SSH session. No tunnel, no forwarding, nothing extra exposed.
- If you truly need a GUI client, enable it *narrowly*: `AllowTcpForwarding local` plus `PermitOpen 127.0.0.1:5432` in the sshd drop-in. Never blanket `AllowTcpForwarding yes` for convenience â€” with it, a stolen SSH key reaches every loopback-bound service you thought was private.

**Fix 3 (always) â€” make loopback-binding the daemon-wide default.**

This is the belt-and-braces that saves you when you â€” or an AI assistant, or a compose file copied off the internet â€” forget the `127.0.0.1:` prefix. Docker supports setting the default host binding address ([Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)):

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json > /dev/null <<'JSON'
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
  "no-new-privileges": true,
  "userland-proxy": false
}
JSON
sudo systemctl restart docker
```

- `"ip": "127.0.0.1"` sets the default bind address for the **default bridge network**; the daemon reference describes `--ip` as "Host IP for port publishing from the default bridge network (default 0.0.0.0)" ([dockerd reference](https://docs.docker.com/reference/cli/dockerd/), [Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)).
- `default-network-opts.bridge.host_binding_ipv4` applies the same default to **user-defined bridge networks** ([Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)). **Docker Compose creates user-defined bridges, so this is the key that actually matters for you** â€” `"ip"` alone does not cover a Compose stack.
- After this, a forgotten `ports: - "5432:5432"` binds to `127.0.0.1:5432` instead of `0.0.0.0:5432`. It converts a catastrophic mistake into a harmless one.
- The reverse proxy, which you *do* want public, must then say so explicitly: `- "0.0.0.0:443:443"`.
- `no-new-privileges: true` â€” daemon-wide default preventing setuid escalation inside containers.
- `userland-proxy: false` â€” removes the `docker-proxy` hop; port forwarding is handled purely in netfilter.
- `live-restore: true` â€” containers keep running across a daemon restart, so `systemctl restart docker` does not take your site down.

Verify it took effect:

```bash
docker network inspect bridge | grep -i host_binding
docker run --rm -d -p 9999:80 --name bindtest nginx >/dev/null && docker port bindtest && docker rm -f bindtest
# expect: 80/tcp -> 127.0.0.1:9999
```

**Fix 4 (always) â€” filter container traffic in the `DOCKER-USER` chain.**

`DOCKER-USER` is the officially supported hook. Docker: *"to add additional rules to filter these packets, use the `DOCKER-USER` chain"*; it is *"A placeholder for user-defined rules that will be processed before rules in the `DOCKER-FORWARD` and `DOCKER` chains"* ([Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/)).

The pattern Docker documents for restricting who may reach published ports is a *negated* rule inserted at the top:

```bash
# Docker's own example: drop everything arriving on the external interface
# except from one subnet
sudo iptables -I DOCKER-USER -i ext_if ! -s 192.0.2.0/24 -j DROP
```

([Docker with iptables â†’ Restrict external connections to containers](https://docs.docker.com/engine/network/firewall-iptables/) â€” "By default, all external source IPs are allowed to connect to ports that have been published to the Docker host's addresses.")

**The conntrack gotcha that trips everyone up.** By the time a packet reaches `DOCKER-USER` it has already been DNATed: *"That means that the `iptables` flags you use can only match internal IP addresses and ports of containers."* To match on the **original** destination â€” "requests that arrived at my public IP on port 443" â€” you must use the conntrack extension ([Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/)):

```bash
sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdst 198.51.100.2 --ctorigdstport 80 -j ACCEPT
```

Docker flags a cost: *"Using the `conntrack` extension may result in degraded performance."* At your traffic level this is irrelevant.

Return traffic must be accepted **before** any DROP rules ([Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/)):

```bash
sudo iptables -I DOCKER-USER -m state --state RELATED,ESTABLISHED -j ACCEPT
```

The complete ordered ruleset for this setup is in Â§3.4, because it is where the Cloudflare allowlist lives. Rules added with `iptables` do not survive a reboot â€” Â§2.6 fixes that.

One more `DOCKER-USER` limitation worth knowing, straight from the docs: packets addressed *directly to a container's own IP* ("direct routed" access) are dropped by a rule in the `raw` table's `PREROUTING` chain, *"which is processed before the `filter` table. So, they never reach the `DOCKER-USER` chain, and a rule in `DOCKER-USER` cannot allow them"* ([Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/)). That default is in your favour â€” leave `allow-direct-routing` alone.

**Fix 5 (do NOT do this) â€” `"iptables": false`.**

You will find this suggested on forums as "the way to make ufw work with Docker." Docker's own documentation is unambiguous:

> "Setting the `iptables` or `ip6tables` keys to `false` in daemon configuration will prevent Docker from creating most of its `iptables` or `nftables` rules. But, this option is not appropriate for most users, it is likely to break container networking for the Docker Engine. For example, with Docker's firewalling disabled and no replacement rules, containers in bridge networks will not be able to access internet hosts by masquerading, **but all of their ports will be accessible to hosts on the local network.**"
> â€” [Docker: Prevent Docker from manipulating firewall rules](https://docs.docker.com/engine/network/packet-filtering-firewalls/)

Read that last clause again. `iptables: false` is not "Docker stops opening ports." It is "Docker stops enforcing isolation *and* stops doing NAT." You get an app whose containers cannot reach the internet **and** a host whose container ports are reachable â€” worse on both axes, unless you hand-write every masquerade and filter rule yourself. Docker adds: *"It is not possible to completely prevent Docker from creating firewall rules, and creating rules after-the-fact is extremely involved and beyond the scope of these instructions."*

**Verdict: never set `iptables: false` on this server.** Fixes 1â€“4 solve the problem completely and keep networking working.

#### 2.4.4 What about the `ufw-docker` community script?

A widely used community project (`chaifeng/ufw-docker`) installs a `DOCKER-USER` ruleset plus a `ufw-docker` helper so that `ufw route allow` works for containers. It is not Docker documentation, not Debian/Ubuntu documentation, and not covered by any vendor's support. Internally it does the same `DOCKER-USER` manipulation as Fix 4, wrapped in a script.

**Recommendation for this owner: skip it.** Fixes 1â€“3 (don't publish; bind to loopback; make loopback the daemon default) remove the exposure entirely without adding a third-party moving part to the security-critical path. Fix 4 covers the one port you *do* publish. Adding an unaudited shell script to the firewall of a machine whose owner cannot read shell scripts is a bad trade. Listed in [What I could not confirm](#what-i-could-not-confirm).

### 2.5 Should you use nftables directly instead of ufw?

`ufw` is a frontend that "ships with Debian and Ubuntu" ([Docker: Docker and ufw](https://docs.docker.com/engine/network/packet-filtering-firewalls/)). Raw `nftables` gives one coherent ruleset instead of ufw's generated one, which experienced administrators often prefer.

**Recommendation for this owner: use ufw.** It is the documented default on both candidate distributions, and `ufw status verbose` is readable by a non-specialist under stress at 2am â€” which is when you will read it.

Critically, **switching to nftables does not help with Â§2.4 at all.** Docker supports an nftables backend (selected with the `firewall-backend` daemon option) and states "For bridge networks, iptables and nftables have the same functionality" ([Docker: Packet filtering and firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/)). The bypass is about *which chain the packet traverses*, not about which frontend wrote the rules. Fix the publishing, not the frontend.

Note also that with the experimental nftables backend, "Docker does not enable IP forwarding itself, and it will not create a default 'drop' nftables policy" ([Docker: Packet filtering and firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/)) â€” a behavioural difference you do not want to discover by accident. Stay on the default iptables backend.

### 2.6 Making the DOCKER-USER rules survive a reboot

`iptables -I` is not persistent, and Docker recreates its chains when the daemon starts, so plain `iptables-persistent` alone is not reliable here. Use your **own** chain, jumped to from `DOCKER-USER`, rebuilt by a systemd unit ordered after Docker:

```bash
sudo apt install -y iptables-persistent netfilter-persistent

sudo tee /etc/systemd/system/foundit-docker-user.service > /dev/null <<'UNIT'
[Unit]
Description=Foundit DOCKER-USER firewall rules (Cloudflare allowlist)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/foundit-cf-firewall.sh

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable foundit-docker-user.service
```

The script `/usr/local/sbin/foundit-cf-firewall.sh` is given in full in Â§3.4. Using a private chain (`FOUNDIT-CF`) that `DOCKER-USER` jumps to means you can flush and rebuild your rules without ever touching a chain Docker owns â€” the pattern that survives `docker restart`, reboots, and Docker upgrades.

### 2.7 IPv6 â€” the half everyone forgets

If the server has a public IPv6 address, **every rule above must exist twice.** A firewall that covers only IPv4 is a firewall with a documented bypass, and scanners do use it.

```bash
grep '^IPV6' /etc/default/ufw            # must read IPV6=yes (default on Ubuntu/Debian)
docker network inspect bridge | grep -i -e enableipv6 -e EnableIPv6
sudo ip6tables -L DOCKER-USER -n         # your rules must exist here too
sudo ss -tlnp | grep '\[::\]'            # anything listening on all IPv6 addresses
```

**The simplest correct answer for this setup: do not give the Hetzner server a public IPv6 address.** Cloudflare terminates IPv6 for your visitors at its own edge and connects to your origin over IPv4, so your users still get IPv6 end to end. You halve the firewall surface and eliminate an entire class of "I firewalled it and it was still open."

If you keep IPv6: add the Cloudflare IPv6 ranges to Hetzner **and** to ufw **and** to `ip6tables`/`DOCKER-USER`. Doing two of the three is worse than doing none, because it feels done.

### 2.8 Egress filtering â€” worth it?

Hetzner permits all outbound by default ([Hetzner: Cloud Firewalls](https://docs.hetzner.com/cloud/firewalls/overview/)). Locking egress down would blunt data exfiltration and stop a compromised container calling home.

**Recommendation: do not filter egress at the Hetzner or ufw layer.** On a box that pulls Docker images, apt packages, ACME certificates and an embeddings API, the allowlist is large and changes without warning, and a broken egress rule presents exactly like an application bug â€” the worst kind of outage for a non-developer to diagnose.

**Do the container-level equivalent instead**, which is free, precise and self-documenting: `networks: { backend: { internal: true } }` from Fix 1. The database and any worker with no business talking to the internet simply have no route to it. That is most of the benefit at none of the operational cost.

---


## 3. Locking the origin to Cloudflare

### 3.1 Why "we're behind Cloudflare" is not, by itself, protection

Cloudflare proxies `foundit.app` â†’ your origin IP. The DDoS scrubbing, the WAF, the bot rules, the rate limiting â€” all of it lives at Cloudflare's edge. **None of it applies to a connection made directly to your origin's IP address.**

Cloudflare says so directly:

> "If someone discovers your origin server's IP address, they could send traffic directly to your server, bypassing Cloudflare's security protections entirely. To prevent this, you should block all traffic that does not come from Cloudflare IP addresses or the IP addresses of your trusted partners, vendors, or applications."
> â€” [Cloudflare: Cloudflare IP addresses](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/)

Your origin IP is not a secret and cannot be made one. It leaks through:
- **Historical DNS records.** Services like SecurityTrails and DNS History keep every A record your domain ever had â€” including the one from before you enabled the orange cloud.
- **Non-proxied DNS records.** A grey-clouded `mail.`, `ftp.`, `dev.` or `staging.` subdomain pointing at the same box gives the address away instantly.
- **Certificate Transparency logs.** Every publicly trusted certificate you issue is logged; a cert for `staging.foundit.app` tells an attacker where to look.
- **Outbound connections your server makes.** An email sent from the server, a webhook it calls, an error report â€” all carry the origin IP.
- **Internet-wide scanning.** Shodan and Censys index every IPv4 address's open ports and TLS certificates continuously. A cert with `foundit.app` in it on a random Hetzner IP is a one-query match.

Assume the origin IP is public. **Therefore the origin must refuse anything that is not Cloudflare.** That is what the rest of this section does.

### 3.2 Where the authoritative Cloudflare IP list lives

| Resource | URL | Format |
|---|---|---|
| Human-readable page | `https://www.cloudflare.com/ips/` | HTML |
| IPv4 plain text | `https://www.cloudflare.com/ips-v4` | one CIDR per line |
| IPv6 plain text | `https://www.cloudflare.com/ips-v6` | one CIDR per line |
| API (no auth needed) | `https://api.cloudflare.com/client/v4/ips` | JSON: `ipv4_cidrs`, `ipv6_cidrs`, `etag` ([API: List IPs](https://developers.cloudflare.com/api/resources/ips/methods/list/)) |

The IPv4 ranges as of **2026-09-10**, fetched from `https://www.cloudflare.com/ips-v4`:

```
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
162.158.0.0/15
104.16.0.0/13
104.24.0.0/14
172.64.0.0/13
131.0.72.0/22
```

**Do not treat that list as permanent.** Cloudflare: *"Cloudflare's IP ranges do not change frequently. When they do change, they are added to our list of IP ranges before being put into production"* ([Cloudflare IP addresses](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/)). The list is published *ahead of* the change, which is exactly what makes automated refresh (Â§3.5) both possible and worth doing: a machine that re-reads the list weekly is never caught out.

The API response includes an `etag`, described as *"A digest of the IP data. Useful for determining if the data has changed"* ([API: List IPs](https://developers.cloudflare.com/api/resources/ips/methods/list/)) â€” that is what makes an automated refresh cheap and idempotent.

### 3.3 Layer 1 + 2a: allow 80/443 from Cloudflare only

**Hetzner Cloud Firewall** (Console â†’ Firewalls â†’ your firewall â†’ Rules). For each inbound rule on port 80 and 443, paste **all fifteen** IPv4 CIDRs into the Source field. Hetzner allows 500 effective rules per firewall ([Hetzner: Cloud Firewalls](https://docs.hetzner.com/cloud/firewalls/overview/)), so 30 entries is trivial.

**ufw**, on the host â€” generate the rules rather than typing fifteen CIDRs twice:

```bash
sudo apt install -y curl
for cidr in $(curl -fsSL https://www.cloudflare.com/ips-v4); do
  sudo ufw allow proto tcp from "$cidr" to any port 80,443 comment 'cloudflare-v4'
done
# Only if the server has public IPv6:
for cidr in $(curl -fsSL https://www.cloudflare.com/ips-v6); do
  sudo ufw allow proto tcp from "$cidr" to any port 80,443 comment 'cloudflare-v6'
done
sudo ufw status numbered
```

Cloudflare documents the equivalent raw-iptables approach â€” allow each range, then a catch-all DROP ([Cloudflare IP addresses](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/)):

```bash
iptables -I INPUT -p tcp -m multiport --dports http,https -s $ip -j ACCEPT
iptables -A INPUT -p tcp -m multiport --dports http,https -j DROP
```

âš ï¸ **Neither of those protects your containers.** Both write to `INPUT`. Your reverse proxy's 443 is a *published Docker port*, so it is forwarded, not INPUT-ed â€” see Â§2.4. The ufw rules above are correct and worth having (they protect anything you later run directly on the host), but the rule that actually enforces the Cloudflare allowlist for your site is the `DOCKER-USER` rule in Â§3.4. **Do both.**

### 3.4 Layer 2b: the DOCKER-USER Cloudflare allowlist (the one that matters)

This is the complete, self-refreshing script referenced by the systemd unit in Â§2.6.

```bash
sudo tee /usr/local/sbin/foundit-cf-firewall.sh > /dev/null <<'SCRIPT'
#!/bin/bash
# Rebuild the Cloudflare allowlist for Docker-published ports 80/443.
# Idempotent: safe to run repeatedly, from cron or systemd.
set -euo pipefail

CHAIN="FOUNDIT-CF"
EXT_IF="$(ip route show default | awk '/default/ {print $5; exit}')"
CACHE_V4=/var/lib/foundit/cloudflare-ips-v4.txt
CACHE_V6=/var/lib/foundit/cloudflare-ips-v6.txt
mkdir -p /var/lib/foundit

# --- Fetch, with a sanity check and a cached fallback -----------------------
tmp="$(mktemp)"
if curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4 -o "$tmp" \
   && [ "$(grep -cE '^[0-9]+(\.[0-9]+){3}/[0-9]+$' "$tmp")" -ge 10 ]; then
  mv "$tmp" "$CACHE_V4"
else
  rm -f "$tmp"
  logger -t foundit-cf "WARN: Cloudflare IPv4 fetch failed or looked wrong; using cache"
  [ -s "$CACHE_V4" ] || { logger -t foundit-cf "FATAL: no cached list"; exit 1; }
fi

# --- (Re)build our own chain ----------------------------------------------
iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"

# 1. Return traffic first â€” Docker documents that this must precede the DROPs.
iptables -A "$CHAIN" -m state --state RELATED,ESTABLISHED -j RETURN

# 2. Anything not arriving on the public interface is not our business.
iptables -A "$CHAIN" ! -i "$EXT_IF" -j RETURN

# 3. Only ports 80/443 are policed here; everything else falls through to
#    Docker's own rules (which reject unpublished ports anyway).
#    NOTE: packets are already DNATed at this point, so we must match on the
#    ORIGINAL destination port via conntrack.
for port in 80 443; do
  while read -r cidr; do
    [ -n "$cidr" ] || continue
    iptables -A "$CHAIN" -p tcp -s "$cidr" \
      -m conntrack --ctorigdstport "$port" -j RETURN
  done < "$CACHE_V4"
  # Everything else that wanted 80/443 gets dropped.
  iptables -A "$CHAIN" -p tcp -m conntrack --ctorigdstport "$port" -j DROP
done

# --- Hook it into DOCKER-USER, at position 1 ------------------------------
iptables -D DOCKER-USER -j "$CHAIN" 2>/dev/null || true
iptables -I DOCKER-USER 1 -j "$CHAIN"

logger -t foundit-cf "Cloudflare allowlist rebuilt on ${EXT_IF} ($(wc -l < "$CACHE_V4") ranges)"
SCRIPT

sudo chmod 700 /usr/local/sbin/foundit-cf-firewall.sh
sudo /usr/local/sbin/foundit-cf-firewall.sh
sudo systemctl enable --now foundit-docker-user.service
sudo iptables -L FOUNDIT-CF -n --line-numbers
```

Design notes, each tied to documented behaviour:

- **A private chain jumped to from `DOCKER-USER`.** `DOCKER-USER` is *"A placeholder for user-defined rules that will be processed before rules in the `DOCKER-FORWARD` and `DOCKER` chains"* ([Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/)). Keeping our rules in `FOUNDIT-CF` means `iptables -F FOUNDIT-CF` never disturbs anything Docker owns.
- **`RETURN`, not `ACCEPT`.** Returning to `DOCKER-USER` lets Docker's own rules make the final decision â€” so an *unpublished* port stays closed even if a Cloudflare IP asks for it. `ACCEPT` here would short-circuit that.
- **`-m conntrack --ctorigdstport`.** Required because *"When packets arrive to the `DOCKER-USER` chain, they have already passed through a Destination Network Address Translation (DNAT) filter"* ([Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/)). Matching `--dport 443` would silently fail if your proxy container listens on 8443 internally.
- **`RELATED,ESTABLISHED` first**, per Docker's guidance that it *"must be placed before `DROP` rules that restrict access from external address ranges"* ([Docker with iptables](https://docs.docker.com/engine/network/firewall-iptables/)).
- **Cached fallback + sanity check.** If Cloudflare is unreachable at boot, the script must not end up with an empty allowlist â€” an empty list plus a trailing DROP is a self-inflicted outage. The `grep -c ... -ge 10` guard also protects against a captive portal or error page being parsed as a CIDR list.

### 3.5 Keeping the list current

```bash
sudo tee /etc/systemd/system/foundit-cf-firewall.timer > /dev/null <<'TIMER'
[Unit]
Description=Weekly refresh of the Cloudflare IP allowlist

[Timer]
OnCalendar=Mon 04:17
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
TIMER

sudo tee /etc/systemd/system/foundit-cf-firewall.service > /dev/null <<'SVC'
[Unit]
Description=Refresh Cloudflare IP allowlist
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/foundit-cf-firewall.sh
SVC

sudo systemctl daemon-reload
sudo systemctl enable --now foundit-cf-firewall.timer
systemctl list-timers foundit-cf-firewall.timer
```

The Hetzner Cloud Firewall entries are **not** automatically refreshed by this. Options, in order of preference:

1. **Leave the Hetzner rules slightly broad on 80/443** (source `0.0.0.0/0`) and let `DOCKER-USER` do the precise filtering. The Hetzner firewall then serves its real purpose: closing everything *except* 22/80/443 no matter what Docker does. This is the recommendation â€” it is one fewer thing to keep in sync, and the precise rule is the one that is automated.
2. Or automate Hetzner too via `hcloud firewall replace-rules`, run from the same timer with a scoped API token. More moving parts, marginal gain.

Set a calendar reminder to eyeball `https://www.cloudflare.com/ips/` quarterly regardless. The automation is there so you never *have* to; the reminder is there because automation silently breaking is a thing.

### 3.6 Authenticated Origin Pulls (mTLS from Cloudflare to your origin)

The firewall allowlist says "this packet came from a Cloudflare IP." Authenticated Origin Pulls says "this TLS connection presented a certificate Cloudflare holds." Belt and braces: the allowlist can go stale between refreshes; AOP cannot.

**Global AOP** is the version you want â€” one dashboard toggle plus one certificate on the origin.

Requirement: the zone must use SSL/TLS encryption mode **Full** or higher ([Cloudflare: Global AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)). Use **Full (strict)** â€” see Â§3.7.

**Step 1 â€” put Cloudflare's client CA on the origin.** Download from `https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem` ([Cloudflare: Global AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)). Note the docs' warning that this is *not* the same as the Cloudflare Origin CA certificate.

```bash
sudo mkdir -p /srv/foundit/certs
sudo curl -fsSL https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem \
  -o /srv/foundit/certs/origin-pull-ca.pem
sudo chmod 644 /srv/foundit/certs/origin-pull-ca.pem
```

**Step 2 â€” configure the reverse proxy to require it.**

nginx ([Cloudflare: Global AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)):

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name foundit.app;

    ssl_certificate     /etc/nginx/certs/origin.pem;
    ssl_certificate_key /etc/nginx/certs/origin.key;

    # --- Authenticated Origin Pulls ---
    ssl_client_certificate /etc/nginx/certs/origin-pull-ca.pem;
    ssl_verify_client on;          # start with "optional" while testing, then "on"

    location / { proxy_pass http://app:3000; }
}
```

Cloudflare's documented pair is `ssl_client_certificate` + `ssl_verify_client optional` for the setup step, then `ssl_verify_client on` to **enforce** ([Cloudflare: Global AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)). Apache's equivalents are `SSLCACertificateFile` and `SSLVerifyClient require` ([same page](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)).

Caddy (if you use Caddy rather than nginx â€” likely, given the audience):

```
foundit.app {
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key {
        client_auth {
            mode                 require_and_verify
            trust_pool file /etc/caddy/certs/origin-pull-ca.pem
        }
    }
    reverse_proxy app:3000
}
```

âš ï¸ The Caddy syntax above is from Caddy's own documentation family, not Cloudflare's â€” verify against your Caddy version's docs. Listed in [What I could not confirm](#what-i-could-not-confirm).

**Step 3 â€” enable it at Cloudflare.** Dashboard â†’ **SSL/TLS â†’ Origin Server â†’ Authenticated Origin Pulls â†’ Global** â†’ toggle **On**. Via API, edit the zone setting `tls_client_auth` to `"on"` ([Cloudflare: Global AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)).

**Step 4 â€” verify enforcement.** From your laptop:

```bash
# Should now FAIL â€” no client certificate presented
curl -sv --resolve foundit.app:443:YOUR.SERVER.IP https://foundit.app/ 2>&1 | tail -20
# expect a TLS alert / 400 "No required SSL certificate was sent"

# Through Cloudflare, should still succeed
curl -sI https://foundit.app/
```

**The limitation you must understand.** Global AOP uses a certificate that is *"not exclusive to your account. It only guarantees that a request is coming from the Cloudflare network"* ([Cloudflare: Global AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)). Anyone else with a Cloudflare account can, in principle, point a zone at your origin IP and their traffic will carry the same certificate. So:

- Global AOP alone is **not** sufficient. It stops random internet scanners and direct-to-IP attacks cold; it does not stop a determined attacker who sets up their own Cloudflare zone.
- **The firewall allowlist and AOP are complementary, and you need both.** The allowlist without AOP lets any Cloudflare customer through. AOP without the allowlist lets any Cloudflare customer through. Together, an attacker must be routing through Cloudflare *and* â€” because your Cloudflare zone applies your WAF and host rules to requests for `foundit.app` â€” hitting a host header your proxy accepts.
- **Also configure the reverse proxy to reject unknown `Host` headers**, which closes the "someone else's Cloudflare zone points at my IP" hole for real:

```nginx
# Default server: anything that is not foundit.app gets nothing.
server {
    listen 443 ssl default_server;
    server_name _;
    ssl_reject_handshake on;   # nginx 1.19.4+
    return 444;
}
```

If you need stronger than "came from Cloudflare", **zone-level AOP** lets you upload your *own* client certificate so only your zone's traffic validates ([Cloudflare: AOP set-up](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/)). That is the correct upgrade path if this app ever handles sensitive data. For launch, global AOP + IP allowlist + host-header rejection is a sound position.

### 3.7 Two Cloudflare settings people get wrong

| Setting | Wrong value | Correct value | Why |
|---|---|---|---|
| **SSL/TLS encryption mode** | `Flexible` | **`Full (strict)`** | `Flexible` means Cloudflare talks **plain HTTP** to your origin. Your "HTTPS site" is unencrypted across the public internet between Cloudflare and Hetzner. `Full` encrypts but does not validate the origin certificate. `Full (strict)` encrypts and validates â€” it also requires a real certificate on the origin, for which Cloudflare's free **Origin CA** certificate (15-year validity) is ideal since it only ever needs to satisfy Cloudflare. AOP requires Full or higher ([Cloudflare: Global AOP](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/)). |
| **Grey-clouded DNS records** | any `A`/`AAAA` record pointing at the origin with the proxy off | proxy **everything**, or point non-proxied records elsewhere | A single grey-clouded record publishes your origin IP in DNS forever, and it is the first thing an attacker checks. Audit with: `dig +short staging.foundit.app; dig +short mail.foundit.app` â€” if any returns your Hetzner IP, fix it. |

### 3.8 The stronger alternative: Cloudflare Tunnel

If you want to eliminate this entire class of problem rather than manage it, **Cloudflare Tunnel** removes the need for *any* inbound port on the origin. The `cloudflared` daemon *"initiates an outbound connection through your firewall from the origin to the Cloudflare global network"*, so you *"can then configure your firewall to allow only these outbound connections and block all inbound traffic, effectively blocking access to your origin from anything other than Cloudflare"* ([Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)).

What that buys you concretely:
- Hetzner Cloud Firewall inbound rules reduce to **SSH only**. Ports 80 and 443 are closed to the entire internet, permanently.
- The Cloudflare IP allowlist becomes unnecessary â€” there is nothing to allowlist to.
- The origin IP leaking stops mattering, because there is nothing listening on it.
- Â§2.4's trap loses most of its teeth, because you stop publishing container ports to public addresses at all.

Costs: one more daemon to run and keep updated (it runs as a container in the same Compose stack), a hard dependency on Cloudflare for *all* availability (no "bypass Cloudflare to debug"), and slightly more involved certificate/routing setup.

**Recommendation: this is the better architecture for this owner**, and worth adopting either at launch or as the first post-launch hardening step. If you are not ready for it, Â§3.1â€“3.7 is a correct and defensible position â€” just implement all of it, not half.

---


## 4. Automatic security updates

### 4.1 Why this is non-negotiable for this owner

Every "how did they get in" post-mortem for a small VPS has the same two candidates: a guessable credential, or a known vulnerability in software that had a patch available for weeks. You have eliminated the first with key-only SSH. `unattended-upgrades` eliminates the second **without requiring you to remember anything**, which is the only kind of security control that survives contact with a busy owner.

On Ubuntu, `unattended-upgrades` "is installed by default on Ubuntu systems and automatically enables security updates" ([Ubuntu Server: Automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/)). On Debian you install and enable it yourself with `sudo dpkg-reconfigure unattended-upgrades` ([Debian Wiki: UnattendedUpgrades](https://wiki.debian.org/UnattendedUpgrades)).

### 4.2 Install and enable

```bash
sudo apt install -y unattended-upgrades apt-listchanges needrestart

# Debian: answer "Yes" to "automatically download and install stable updates?"
sudo dpkg-reconfigure -plow unattended-upgrades

# Verify the periodic scheduler is on:
cat /etc/apt/apt.conf.d/20auto-upgrades
```

That file must contain ([Ubuntu Server: Automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/)):

```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

"Each value represents days between runs. Set to `0` to disable. Default `1` means daily execution" ([Ubuntu Server: Automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/)).

Add download-and-clean too, so the daily run is fast and `/var/cache/apt` does not grow forever:

```bash
sudo tee /etc/apt/apt.conf.d/20auto-upgrades > /dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
```

### 4.3 Which updates to apply unattended, and which not

The Debian wiki notes that "the default configuration auto-installs security updates, but not new features" ([Debian Wiki: UnattendedUpgrades](https://wiki.debian.org/UnattendedUpgrades)). That default is correct and you should mostly keep it.

Ubuntu's shipped `Allowed-Origins` ([Ubuntu Server: Automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/)):

```
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
```

| Origin | Unattended? | Why |
|---|---|---|
| `${distro_codename}-security` | **Yes, always** | This is the entire point. Security fixes for OpenSSH, glibc, OpenSSL, the kernel. |
| `${distro_codename}` (the base release) | **Yes** | On a stable release this only ever carries point-release fixes. Low risk. |
| `ESMApps` / `ESM` (Ubuntu Pro) | **Yes** | Extended security maintenance for universe/main. Free for up to 5 machines. |
| `${distro_codename}-updates` | **No** â€” leave commented out | Non-security bug fixes and version bumps. Unattended installation of these is how a working server changes behaviour at 06:00 for no reason. Apply these manually, monthly, when you are watching. |
| `${distro_codename}-backports` | **No** | Never unattended. Backports are opt-in newer software. |
| **Docker's own APT repo** | **No** | A Docker Engine upgrade restarts the daemon. With `live-restore: true` (Â§2.4.3) that is survivable, but a *major* version bump is not something to discover after the fact. Upgrade Docker deliberately, monthly. |
| **Your application images** | **No â€” and unattended-upgrades never touches these anyway** | Your app's dependencies live inside Docker images, entirely outside APT. Â§4.6. |

**Blacklist anything whose restart would take the site down** â€” even though it means you must patch those manually:

```
Unattended-Upgrade::Package-Blacklist {
    // Nothing here at launch. Add a package only after it has actually
    // broken you, and write the date and reason next to it.
    // Example:
    //   "docker-ce";   // 2026-09: upgrade restarted the daemon mid-deploy
};
```

Starting with an empty blacklist is the right call. A blacklist entry is a permanent unpatched surface; earn each one.

### 4.4 The full configuration file

Write a **local** override so package upgrades never clobber it â€” the Debian wiki's recommended pattern is to copy the shipped file to a higher-numbered name and edit the copy ([Debian Wiki: UnattendedUpgrades](https://wiki.debian.org/UnattendedUpgrades)):

```bash
sudo tee /etc/apt/apt.conf.d/52unattended-upgrades-local > /dev/null <<'EOF'
// --- Foundit local overrides. Takes precedence over 50unattended-upgrades. ---

// Email me. Requires a working MTA or msmtp; see Â§4.7.
Unattended-Upgrade::Mail "you@example.com";
Unattended-Upgrade::MailReport "on-change";   // always | only-on-error | on-change

// Keep the disk from filling with old kernels.
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";

// Reboot automatically when a package says a reboot is required.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";

// Do not fail silently on a broken package.
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";

// Randomise so every server on the internet does not hammer the mirrors at once.
Unattended-Upgrade::Random-Sleep "true";
EOF
```

Every one of `Automatic-Reboot`, `Automatic-Reboot-Time`, `Automatic-Reboot-WithUsers`, `Mail`, `MailReport` and `Remove-Unused-Kernel-Packages` is a documented option ([Ubuntu Server: Automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/)). Note the shipped defaults are `Automatic-Reboot "false"` and `Automatic-Reboot-Time "now"` â€” **"now" is why you must set a time if you set reboot to true.**

Test before trusting it:

```bash
sudo unattended-upgrade -v --dry-run
```

"The `-v` flag provides verbose output showing which packages would be upgraded" ([Ubuntu Server: Automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/)). Debian's wiki gives the equivalent debug form, `sudo unattended-upgrade -d` ([Debian Wiki: UnattendedUpgrades](https://wiki.debian.org/UnattendedUpgrades)).

Then read the log after the first real run:

```bash
sudo tail -50 /var/log/unattended-upgrades/unattended-upgrades.log
```

### 4.5 Which updates need a reboot, and a sane reboot policy

**What needs a reboot:** the kernel, and `systemd` itself. Nothing else, strictly.

**What needs a service restart but not a reboot:** OpenSSL, glibc, libssl â€” any library a running process has mapped. The process keeps using the *old, vulnerable* copy until restarted. This is the widely missed half: `apt upgrade` patched the file on disk; your nginx is still running the vulnerable code in memory.

`needrestart` (installed in Â§1.4) detects exactly this:

```bash
sudo needrestart -b        # batch mode: lists services and whether a reboot is needed
sudo needrestart -r a      # restart affected services automatically
```

Configure it to act without prompting during unattended runs:

```bash
sudo tee /etc/needrestart/conf.d/50-foundit.conf > /dev/null <<'EOF'
# a = automatically restart services, i = interactive, l = list only
$nrconf{restart} = 'a';
# Do not prompt about the kernel; the reboot policy handles that.
$nrconf{kernelhints} = 0;
EOF
```

**Is a reboot pending?**

```bash
ls -l /var/run/reboot-required /var/run/reboot-required.pkgs 2>/dev/null && cat /var/run/reboot-required.pkgs
```

**The reboot policy for a single-machine service.** You have no second server, so a reboot is a real outage of 20â€“60 seconds. The honest trade-off:

| Policy | Outage | Risk | Verdict |
|---|---|---|---|
| Never reboot; patch manually when you notice | 0 | Kernel vulnerabilities stay live indefinitely. Uptime becomes a liability. | **No.** This is how a server ends up 400 days behind. |
| `Automatic-Reboot "true"` at a fixed low-traffic hour | ~40s, at 04:30 | Small chance a reboot happens during a rare 04:30 usage spike; small chance the box does not come back cleanly. | **Yes â€” this is the recommendation.** |
| Livepatch + reboot monthly | ~40s/month | Best-of-both, but Livepatch's own docs say it is "not a replacement for rebooting". | Yes, as an addition to the above, not a substitute. |

Set `Automatic-Reboot-Time "04:30"` in your lowest-traffic hour **in the server's timezone** â€” check with `timedatectl` and set it to UTC (`sudo timedatectl set-timezone UTC`) so logs and schedules stop lying to you across daylight-saving changes.

Two prerequisites before you trust automatic reboots:

1. **Every container must have `restart: unless-stopped`** in the compose file, and the Compose stack must be a systemd unit or started by Docker's own restart policy. Verify by actually rebooting once, deliberately, on a Tuesday afternoon:
   ```bash
   sudo reboot
   # 60 seconds later, from your laptop:
   curl -sI https://foundit.app/ | head -1     # expect: HTTP/2 200
   ```
   **Do this on day one.** A server that cannot survive a planned reboot cannot survive an unplanned one, and you want to find that out while you are awake.
2. **Postgres data must be on a volume that survives**, and the container must shut down cleanly (Docker sends SIGTERM and waits; Postgres handles it correctly).

### 4.6 The gap unattended-upgrades does not cover: your Docker images

This is the most important paragraph in section 4. **`unattended-upgrades` patches the host's APT packages. It does not touch anything inside a container.** Your Next.js image's base OS, its OpenSSL, its Node runtime, and your npm dependencies are all frozen at build time and will never be updated by anything on this list.

A server with perfect `unattended-upgrades` and a two-year-old `node:20-alpine` base image is not patched.

Minimum viable coverage:

```bash
# 1. Pin base images to a digest in your Dockerfile so builds are reproducible,
#    and bump that digest deliberately on a schedule.

# 2. Monthly: rebuild and redeploy, which pulls current base images.
cd /srv/foundit
sudo docker compose pull
sudo docker compose build --pull --no-cache
sudo docker compose up -d
sudo docker image prune -af

# 3. Scan what you are actually running. Docker Scout ships with Docker Desktop
#    and is available as a CLI plugin; Trivy is the common standalone.
sudo docker scout cves foundit-app:latest     # or:
sudo docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
     aquasec/trivy image foundit-app:latest
```

âš ï¸ That Trivy invocation mounts `docker.sock` into a container, which Â§6.6 tells you never to do. Run Trivy against a **registry image** (`trivy image registry/foundit-app:tag`, no socket) or install the Trivy binary on the host instead. Included here specifically because it is the exact copy-paste that undoes your container hardening.

Set a monthly calendar reminder titled "rebuild containers". It is the single maintenance task most likely to be skipped and most likely to matter.

### 4.7 Making sure you actually see the notifications

`Unattended-Upgrade::Mail` "may require you to configure a local MTA" ([Debian Wiki: UnattendedUpgrades](https://wiki.debian.org/UnattendedUpgrades)). Installing a full Postfix on a hardened server is overkill and adds a listening service. Use `msmtp` as a sendmail-compatible relay through an existing mailbox:

```bash
sudo apt install -y msmtp msmtp-mta
sudo tee /etc/msmtprc > /dev/null <<'EOF'
defaults
auth           on
tls            on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        /var/log/msmtp.log

account        default
host           smtp.example-provider.com
port           587
from           foundit-server@example.com
user           foundit-server@example.com
passwordeval   "cat /etc/msmtp-password"
EOF
sudo chmod 600 /etc/msmtprc /etc/msmtp-password
sudo chown root:root /etc/msmtprc /etc/msmtp-password
echo "test from foundit server" | mail -s "foundit test" you@example.com
```

Use an app-specific password from a dedicated address, never your personal mailbox password, and give the file mode `600` (Â§6). If email is too much friction, `MailReport "only-on-error"` plus the weekly checklist in Â§9 is an acceptable fallback â€” but silence should never mean "probably fine" by default.

### 4.8 Kernel livepatch

**Ubuntu Livepatch** "patches the Linux kernel between security maintenance windows, while the system runs" and is "available free for up to 5 machines, for personal use, or evaluation purposes" ([Ubuntu: Livepatch](https://ubuntu.com/security/livepatch)).

```bash
sudo pro attach [YOUR_TOKEN]        # token from ubuntu.com/pro
sudo pro enable livepatch
sudo pro status
canonical-livepatch status --verbose
```

([Ubuntu: Livepatch](https://ubuntu.com/security/livepatch))

**What Livepatch does not do â€” read this before deciding it solves your reboot problem:**

- "It patches only kernel vulnerabilities with critical/high severity ratings" ([Ubuntu: Livepatch](https://ubuntu.com/security/livepatch)). Medium-severity kernel issues still need a reboot.
- "does not patch userspace libraries like OpenSSL or glibc" ([Ubuntu: Livepatch](https://ubuntu.com/security/livepatch)). Those are the ones that most often affect a web app, and they need a **service restart**, which is what `needrestart` handles.
- It is "not a replacement for rebooting" â€” scheduled reboots remain necessary "to flush accumulated state inconsistencies from memory leaks" ([Ubuntu: Livepatch](https://ubuntu.com/security/livepatch)).

**Recommendation:** if you chose Ubuntu, enable Livepatch â€” it is free at your scale and strictly reduces exposure between reboots. Then still set `Automatic-Reboot "true"`, perhaps relaxed to a monthly cadence rather than "whenever a reboot is flagged". Do **not** enable Livepatch and then turn automatic reboots off; that is the misunderstanding the vendor's own documentation warns against.

Debian has no equivalent free offering. If you chose Debian, automatic reboots are your only kernel-patching path, which is a mild argument in favour of Ubuntu for this deployment.

---


## 5. Intrusion prevention and detection

### 5.1 fail2ban or CrowdSec? â€” the recommendation and the reasoning

**Recommendation: fail2ban, with an SSH jail only. Do not install CrowdSec at launch.**

This will look like the boring answer, so here is the reasoning, which is specific to *your* architecture rather than generic.

**What CrowdSec is genuinely better at.** CrowdSec is an "Open-source agent that parses logs, applies scenarios, and bans IPs", and users are "Immediately protected with the Community Blocklist" ([CrowdSec: Intro](https://docs.crowdsec.net/docs/next/getting_started/intro/)). Its firewall bouncer solves the Docker problem correctly â€” its docs say: *"If you are using a dockerized application and allow remote connections to the exposed port, you need to add the `DOCKER-USER` chain to the list"* ([CrowdSec: Firewall bouncer](https://docs.crowdsec.net/u/bouncers/firewall/)), configured as:

```yaml
iptables_chains:
  - INPUT
  - FORWARD
  - DOCKER-USER
```

That is a real advantage over fail2ban, whose default `banaction` is `iptables-multiport` ([jail.conf(5)](https://manpages.ubuntu.com/manpages/noble/man5/jail.conf.5.html)) writing to `INPUT` â€” which, per Â§2.4, **does not affect Docker-published ports at all.**

**Why that advantage does not pay off here.** Your web traffic reaches the origin **only from Cloudflare IP ranges** (Â§3). Therefore:

1. Every HTTP request in your proxy's logs has a Cloudflare source IP unless you configure real-IP restoration.
2. If CrowdSec bans an attacker's IP at the origin firewall, it bans nothing â€” the attacker's packets never carried that IP to your box.
3. If real-IP restoration *is* configured and CrowdSec bans the restored address in `DOCKER-USER`, it still bans nothing, because the packets arrive from a Cloudflare IP.
4. If it somehow banned the Cloudflare IP the request came from, it would **take a slice of your legitimate users offline.** This is a real, common self-inflicted outage.

**Web-layer IP blocking belongs at Cloudflare, not on your origin.** Cloudflare's WAF, rate-limiting rules and bot controls act at the edge where the attacker's real IP is the connecting IP. That is the correct place, it is included in your plan, and it costs nothing extra.

**What is left for a host-based tool?** SSH. And SSH traffic goes to the host, hits `INPUT`, and is exactly what fail2ban was built for and handles correctly.

So the division of labour is:

| Layer | Tool | Blocks |
|---|---|---|
| Web (80/443) | **Cloudflare WAF + rate limiting rules** | Real attacker IPs, at the edge, before they reach you |
| Origin network | **Hetzner Cloud Firewall + `DOCKER-USER` allowlist** | Everything not from Cloudflare |
| SSH | **fail2ban** | Repeated failed auth from the same source |

**When to revisit and adopt CrowdSec:** if you ever stop fronting the app with Cloudflare, if you expose a non-HTTP service to the internet, or if you want the community blocklist applied pre-emptively. If you do adopt it *while* still on Cloudflare, use the **Cloudflare bouncer** (which pushes decisions into Cloudflare's own firewall) rather than the origin firewall bouncer â€” that puts the block where the attacker's IP actually is.

For completeness, the CrowdSec install path is `curl -s https://install.crowdsec.net | sudo sh` then `sudo apt install crowdsec`, plus `sudo apt install crowdsec-firewall-bouncer-iptables`; note their warning that *"the Security Engine by itself is a detection engine â€” it will not block anything"* without a bouncer ([CrowdSec: Linux installation](https://docs.crowdsec.net/u/getting_started/installation/linux/)).

### 5.2 fail2ban configuration

Never edit `jail.conf` â€” settings in a file parsed later take precedence, so `jail.local` is the supported override ([jail.conf(5)](https://manpages.ubuntu.com/manpages/noble/man5/jail.conf.5.html)).

```bash
sudo tee /etc/fail2ban/jail.local > /dev/null <<'EOF'
[DEFAULT]
# Never lock yourself out. Add your home/office IP and any monitoring source.
ignoreip = 127.0.0.1/8 ::1 203.0.113.45

# Read from the systemd journal rather than a log file that may not exist.
backend  = systemd

# Escalating bans: 1h first, doubling, capped at a week.
bantime            = 1h
bantime.increment  = true
bantime.factor     = 2
bantime.maxtime    = 1w
findtime           = 10m
maxretry           = 3

# Ban all ports for this source, not just the one they attacked.
banaction       = iptables-allports
banaction_allports = iptables-allports

destemail = you@example.com
sender    = foundit-server@example.com
action    = %(action_mw)s

[sshd]
enabled  = true
port     = 52242
filter   = sshd
mode     = aggressive
maxretry = 3

# Everything else stays off. There is nothing else on this host to protect,
# and a jail reading Cloudflare-sourced web logs would ban your own users.
[sshd-ddos]
enabled = false
EOF

sudo systemctl enable --now fail2ban
sudo systemctl restart fail2ban
```

The options used are all documented in [jail.conf(5)](https://manpages.ubuntu.com/manpages/noble/man5/jail.conf.5.html): `bantime` ("effective ban duration"), `findtime` ("time interval ... before the current time where failures will count towards a ban"), `maxretry` ("number of failures that have to occur in the last findtime seconds to ban the IP"), `ignoreip` ("list of IPs not to ban ... can include a DNS resp. CIDR mask too"), `banaction` ("banning action (default iptables-multiport)"), `backend` ("backend to be used to detect changes in the logpath. It defaults to 'auto'"), `filter`, `action` and `logpath`.

`bantime.increment`, `bantime.factor` and `bantime.maxtime` are **not** in the Ubuntu manpage excerpt â€” they are fail2ban 0.11+ features documented in the shipped `jail.conf` comments. Verify on your machine with `grep -n 'bantime.increment' /etc/fail2ban/jail.conf` before relying on them; see [What I could not confirm](#what-i-could-not-confirm).

**Three fail2ban traps, in order of how often they bite:**

1. **`backend = auto` finds no log and silently does nothing.** Recent Debian and Ubuntu images often ship without `rsyslog`, so `/var/log/auth.log` does not exist and the `sshd` jail reads an empty file forever, while `systemctl status fail2ban` reports "active (running)". Setting `backend = systemd` reads the journal directly and removes the failure mode. **Verify it is actually seeing events** â€” this is the only proof that matters:
   ```bash
   sudo fail2ban-client status sshd
   # "Total failed" must be > 0 after you deliberately fail a login.
   ```
   Test it for real from a phone hotspot or another machine:
   ```bash
   for i in 1 2 3 4; do ssh -p 52242 -o PubkeyAuthentication=no nosuchuser@YOUR.SERVER.IP; done
   # then on the server:
   sudo fail2ban-client status sshd     # your test IP should be listed as banned
   sudo fail2ban-client set sshd unbanip YOUR.TEST.IP
   ```
2. **fail2ban does not protect Docker-published ports.** Its default `iptables-multiport` action writes to `INPUT` ([jail.conf(5)](https://manpages.ubuntu.com/manpages/noble/man5/jail.conf.5.html)); Docker's published ports never traverse `INPUT` (Â§2.4). Do not add a web jail expecting it to work. This is not a bug you can configure away with `banaction`; it is the same architectural fact as Â§2.4.
3. **`ignoreip` is your seatbelt.** Put your own address in it before you start testing bans. If your ISP address is dynamic, keep the Hetzner web console tab open while testing (Â§1.10 Path A defeats any fail2ban ban, because the console is not on the network).

Useful commands:

```bash
sudo fail2ban-client status                 # which jails are running
sudo fail2ban-client status sshd            # failures, bans, currently banned list
sudo fail2ban-client set sshd unbanip 1.2.3.4
sudo fail2ban-client set sshd banip 1.2.3.4
sudo journalctl -u fail2ban -n 50 --no-pager
```

### 5.3 Auditing what changed: auditd, and the lighter alternative

**Recommendation: skip `auditd` at launch. Adopt the light stack in Â§5.3.2. Add `auditd` only if you ever have a compliance requirement or an actual incident to investigate.**

#### 5.3.1 What auditd would give you, and why it is the wrong first tool here

`auditd` records kernel-level events. Watch rules use `auditctl -w path -p permissions -k key`, where permissions are "r=read, w=write, x=execute, a=attribute change" and the key "can uniquely identify the audit records produced by a rule" ([auditctl(8)](https://manpages.ubuntu.com/manpages/noble/man8/auditctl.8.html)). Syscall rules use `auditctl -a always,exit -F field=value -S syscall`, where "always" means the kernel will "always fill it in at syscall entry time, and always write out a record at syscall exit time" ([auditctl(8)](https://manpages.ubuntu.com/manpages/noble/man8/auditctl.8.html)). Rules persist in `/etc/audit/audit.rules` and the `/etc/audit/` directory ([auditctl(8)](https://manpages.ubuntu.com/manpages/noble/man8/auditctl.8.html)), and `auditctl -e 2` locks the configuration so that changes require a reboot ([auditctl(8)](https://manpages.ubuntu.com/manpages/noble/man8/auditctl.8.html)).

If you did install it, a minimal ruleset appropriate to this server would be:

```bash
sudo apt install -y auditd audispd-plugins
sudo tee /etc/audit/rules.d/50-foundit.rules > /dev/null <<'EOF'
# Identity and privilege
-w /etc/passwd    -p wa -k identity
-w /etc/shadow    -p wa -k identity
-w /etc/group     -p wa -k identity
-w /etc/sudoers   -p wa -k privilege
-w /etc/sudoers.d/ -p wa -k privilege

# Remote access configuration
-w /etc/ssh/sshd_config    -p wa -k sshd
-w /etc/ssh/sshd_config.d/ -p wa -k sshd
-w /root/.ssh/             -p wa -k ssh_keys
-w /home/founditops/.ssh/  -p wa -k ssh_keys

# The things this document told you to configure
-w /etc/docker/daemon.json -p wa -k docker_cfg
-w /srv/foundit/           -p wa -k app
-w /usr/local/sbin/        -p wa -k local_bin

# Docker socket access is a root-equivalent action
-w /var/run/docker.sock -p rwa -k docker_sock

# Scheduled tasks
-w /etc/crontab   -p wa -k cron
-w /etc/cron.d/   -p wa -k cron
-w /etc/systemd/system/ -p wa -k systemd_units

# Kernel module loading
-a always,exit -F arch=b64 -S init_module,finit_module,delete_module -k modules

-b 8192
EOF
sudo augenrules --load && sudo systemctl restart auditd
sudo ausearch -k sshd -i | tail -20
```

**Why not to, for this owner:** `auditd` on a busy container host produces a large volume of records in a format that is genuinely hard to read, it competes with Docker for the audit netlink socket in some configurations, and â€” decisively â€” **an audit log that nobody reads provides zero security and non-zero disk consumption and CPU.** It is a tool for someone who will look at it. You have told me, honestly, that you are not that person yet.

#### 5.3.2 The lighter alternative that a non-developer will actually use

Four sources, all already on the machine, all readable:

**a) What packages changed, and when.**
```bash
# Human-readable APT history, including who ran it
sudo less /var/log/apt/history.log
grep -E '^(Start-Date|Commandline|Upgrade|Install|Remove)' /var/log/apt/history.log | tail -40
```

**b) Who logged in, and who failed.**
```bash
last -20                                     # successful logins
lastb -20                                    # failed logins (needs /var/log/btmp)
sudo journalctl -u ssh --since "7 days ago" | grep -E 'Accepted|Failed|Invalid'
sudo journalctl _COMM=sudo --since "7 days ago" --no-pager    # every sudo invocation
```

**c) Did any *shipped* file change?** `debsums` verifies installed files against the package manager's checksums. This catches a trojanised system binary â€” the single highest-value integrity check on a Debian-family box, and it takes one command:
```bash
sudo apt install -y debsums
sudo debsums -c        # lists any file whose checksum no longer matches its package
```
An empty output is the expected, good result.

**d) File integrity monitoring for the paths that matter.** `AIDE` builds a baseline database and reports differences. Scope it tightly so the report is short enough to read:
```bash
sudo apt install -y aide aide-common
sudo tee /etc/aide/aide.conf.d/99_foundit > /dev/null <<'EOF'
/etc/ssh          FIPSR
/etc/sudoers      FIPSR
/etc/sudoers.d    FIPSR
/root/.ssh        FIPSR
/home/founditops/.ssh FIPSR
/usr/local/sbin   FIPSR
/etc/docker       FIPSR
/srv/foundit      FIPSR
EOF
sudo aideinit          # builds the baseline â€” do this on day one, before going live
sudo aide.wrapper --check | head -50
```
âš ï¸ **A baseline built after a compromise is a baseline of the compromise.** Run `aideinit` on day one. The Debian `aide-common` package installs a daily cron job that emails the report; if you use that, make sure Â§4.7's mail actually works, otherwise it is theatre.

**Something to be honest about:** an attacker with root can edit `/var/log`, `/var/lib/aide/aide.db`, and the AIDE config. Local logs and local integrity databases detect *mistakes and unsophisticated intrusions*, not a competent attacker who got root. The only real defences against that are (i) shipping logs off the box, and (ii) rebuilding rather than cleaning (Â§7). Given the scale, ship the logs somewhere free â€” Cloudflare Logpush, a Grafana Cloud free tier, or even `journalctl` output rsynced nightly to a different provider â€” and accept that on-box detection is best-effort.

### 5.4 What to look at weekly, and what to never look at

This table is the whole point of section 5. A monitoring setup nobody reads is worse than none, because it manufactures false confidence.

| Frequency | What | Command / place | Why this one |
|---|---|---|---|
| **Automatic, pushes to you** | Site down | Free uptime monitor (UptimeRobot, Better Stack free tier) hitting `https://foundit.app/healthz` every 5 min, alerting to your phone | The single highest-value alert you will ever configure. Most compromises that matter eventually break something. |
| **Automatic** | Disk filling | `df -h` in the weekly digest; alert at 80% | A full disk takes Postgres down and looks exactly like a hack. Docker logs and images are the usual culprit â€” `daemon.json` in Â§2.4.3 caps log size. |
| **Automatic** | unattended-upgrades report | Email, `MailReport "on-change"` (Â§4.4) | Tells you patching is alive. Silence for two weeks means it broke. |
| **Weekly, 5 minutes** | Failed and successful SSH logins | `sudo journalctl -u ssh --since "7 days ago" \| grep -E 'Accepted\|Failed'` | With key-only auth on a non-standard port this should be nearly empty. **A single `Accepted publickey` you do not recognise is the alarm.** |
| **Weekly, 1 minute** | fail2ban state | `sudo fail2ban-client status sshd` | Confirms the tool is alive and counting. `Total failed: 0` after weeks is suspicious, not reassuring. |
| **Weekly, 1 minute** | What is listening, and where | `sudo ss -tlnp` and `docker ps --format 'table {{.Names}}\t{{.Ports}}'` | The Â§2.4 regression check. A deploy that added `ports: - "6379:6379"` shows up here and nowhere else. |
| **Weekly, 30 seconds** | Firewall still on | `sudo ufw status verbose` and `sudo iptables -L FOUNDIT-CF -n \| head` | Both must be non-empty. |
| **Monthly** | Package integrity | `sudo debsums -c` | Should print nothing. |
| **Monthly** | Container rebuild | Â§4.6 | The most-skipped and most-important task. |
| **Monthly** | Restore a backup | Â§7.4 | An untested backup is a hope. |
| **Quarterly** | Cloudflare IP list eyeball | `https://www.cloudflare.com/ips/` vs `/var/lib/foundit/cloudflare-ips-v4.txt` | The automation should make this unnecessary. Check anyway. |
| **Quarterly** | External port scan | Â§8 | The only check that proves what the internet sees. |
| **Never** | Raw `auditd` records | â€” | Unless you are investigating a specific incident, with a specific question. |
| **Never** | Raw nginx/Caddy access logs, line by line | â€” | Behind Cloudflare these are Cloudflare IPs hitting your app. Use Cloudflare's own analytics dashboard instead â€” it has the real client IPs, the country, the bot score, and a UI. |
| **Never** | `/var/log/syslog` in full | â€” | It is the wrong altitude. Query it when you have a question; do not read it as a practice. |

Automate the weekly ones into a single email so "weekly review" is reading one message, not running eight commands:

```bash
sudo tee /usr/local/sbin/foundit-weekly-digest.sh > /dev/null <<'DIGEST'
#!/bin/bash
{
  echo "=== FOUNDIT WEEKLY DIGEST â€” $(date -u) ==="
  echo; echo "--- Uptime / load ---"; uptime
  echo; echo "--- Disk ---"; df -h / /var/lib/docker 2>/dev/null
  echo; echo "--- Memory ---"; free -h
  echo; echo "--- Reboot required? ---"
  [ -f /var/run/reboot-required ] && cat /var/run/reboot-required.pkgs || echo "no"
  echo; echo "--- Listening sockets (check for 0.0.0.0 on anything but 80/443) ---"
  ss -tlnp
  echo; echo "--- Published container ports ---"
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo; echo "--- ufw ---"; ufw status verbose
  echo; echo "--- Cloudflare allowlist chain (first 5) ---"
  iptables -L FOUNDIT-CF -n | head -8
  echo; echo "--- fail2ban ---"; fail2ban-client status sshd 2>/dev/null
  echo; echo "--- SSH logins, last 7 days ---"
  journalctl -u ssh --since "7 days ago" --no-pager | grep -E 'Accepted|Failed|Invalid' | tail -30
  echo; echo "--- sudo use, last 7 days ---"
  journalctl _COMM=sudo --since "7 days ago" --no-pager | tail -20
  echo; echo "--- Package changes, last 7 days ---"
  grep -A3 "$(date -d '7 days ago' +%Y-%m)" /var/log/apt/history.log 2>/dev/null | tail -30
  echo; echo "--- Last unattended-upgrades run ---"
  tail -5 /var/log/unattended-upgrades/unattended-upgrades.log 2>/dev/null
} | mail -s "Foundit weekly digest â€” $(hostname)" you@example.com
DIGEST
sudo chmod 700 /usr/local/sbin/foundit-weekly-digest.sh

# Run it Mondays at 08:00
sudo tee /etc/systemd/system/foundit-digest.timer > /dev/null <<'EOF'
[Unit]
Description=Weekly Foundit digest
[Timer]
OnCalendar=Mon 08:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
sudo tee /etc/systemd/system/foundit-digest.service > /dev/null <<'EOF'
[Unit]
Description=Weekly Foundit digest
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/foundit-weekly-digest.sh
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now foundit-digest.timer
```

---


## 6. Secrets on the host, and containing a compromised container

### 6.1 Where the files live and what they are set to

```bash
sudo mkdir -p /srv/foundit/secrets
sudo chown -R founditops:founditops /srv/foundit
sudo chmod 750 /srv/foundit
sudo chmod 700 /srv/foundit/secrets
```

| Path | Owner | Mode | Contents |
|---|---|---|---|
| `/srv/foundit/` | `founditops:founditops` | `750` | `docker-compose.yml`, `Caddyfile`, everything version-controllable |
| `/srv/foundit/.env` | `founditops:founditops` | **`600`** | Non-secret configuration only â€” ports, hostnames, feature flags, log level |
| `/srv/foundit/secrets/` | `founditops:founditops` | **`700`** | One file per secret, each `600`. Never in git. |
| `/srv/foundit/secrets/db_password` | `founditops:founditops` | **`600`** | Postgres password, no trailing newline |
| `/srv/foundit/data/` | per-container UID | `700` | Postgres data volume, backups staging |

Verify â€” and put this in the weekly digest:

```bash
find /srv/foundit -name '*.env' -o -name '.env' -o -path '*/secrets/*' \
  | xargs -r stat -c '%a %U:%G %n'
# every line must start with 600 or 700, owned by founditops
```

Generate secrets rather than inventing them:

```bash
umask 077
openssl rand -base64 32 | tr -d '\n' > /srv/foundit/secrets/db_password
openssl rand -hex 32   | tr -d '\n' > /srv/foundit/secrets/nextauth_secret
chmod 600 /srv/foundit/secrets/*
```

Add to `.gitignore` **before the first commit**, not after:

```gitignore
.env
.env.*
!.env.example
secrets/
*.pem
*.key
```

### 6.2 Why `docker inspect` and the process list leak environment variables

Docker's own documentation is blunt about the problem:

> "If you're injecting passwords and API keys as environment variables, you risk unintentional information exposure. Environment variables are often available to all processes, and it can be difficult to track access. They can also be printed in logs when debugging errors without your knowledge."
> â€” [Docker Compose: Use secrets](https://docs.docker.com/compose/how-tos/use-secrets/)

Concretely, here is your database password, four different ways:

```bash
# 1. docker inspect â€” plain text, no root needed if you are in the docker group
docker inspect foundit-db | grep -A20 '"Env"'
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' foundit-db

# 2. The process environment on the host
sudo cat /proc/$(pgrep -f postgres | head -1)/environ | tr '\0' '\n'

# 3. The process list with the environment flag
ps auxe | grep -i postgres

# 4. Compose's own rendered configuration â€” often pasted into a chat when debugging
docker compose config
```

Each of these is a routine debugging command. Every one of them prints secrets. The realistic leak paths are not "an attacker ran `docker inspect`" â€” they are:

- **You paste `docker compose config` output into an AI assistant, a forum, or a support ticket.** This is the most likely way your production database password ends up somewhere it should not be. It has happened to a great many people.
- **A crash reporter (Sentry, Rollbar, Bugsnag) captures the process environment** with the stack trace and ships it to a third party.
- **A child process inherits the environment** and logs it, or a dependency prints `process.env` on startup in debug mode.
- **`docker inspect` output goes into a monitoring agent** that indexes container metadata.
- **Anyone in the `docker` group can read every container's environment.** The `docker` group is root-equivalent (Â§6.6).

### 6.3 Docker secrets versus env files â€” the honest comparison

Compose secrets are "mounted as files at a standardized path within containers: `/run/secrets/<secret_name>`", defined in the top-level `secrets` element and granted "on a per-service basis" ([Docker Compose: Use secrets](https://docs.docker.com/compose/how-tos/use-secrets/)).

| | `.env` / `environment:` | Compose file secrets |
|---|---|---|
| Visible in `docker inspect` | **Yes, plain text** | No â€” only the mount path |
| Visible in `/proc/PID/environ` | **Yes** | No |
| Visible in `docker compose config` | **Yes** | No â€” shows the file path |
| Captured by crash reporters | **Usually** | No |
| Inherited by child processes | **Yes, automatically** | No |
| Readable inside the container | Yes | Yes â€” at `/run/secrets/<name>` |
| Rotation | Restart container | Rewrite file, restart container |
| Works with unmodified upstream images | Yes | **Only if the image supports it** |
| On disk on the host | Yes, in `.env` | Yes, in the secret file |
| Encrypted at rest | **No** | **No** â€” this is not encryption |

**The honest caveats, because Compose secrets are often oversold:**

1. **They are not encrypted.** In Compose (as opposed to Swarm), a "secret" is a file on the host bind-mounted into the container. The protection is *scope* â€” it does not enter the environment, so it does not leak through the four channels in Â§6.2. That is a real and worthwhile improvement, but the file on disk is exactly as protected as its permissions make it.
2. **The image must support file-based secrets.** Postgres does: `POSTGRES_PASSWORD_FILE`. Many images do not, and for those you are back to environment variables or an entrypoint wrapper that reads the file and exports it â€” which puts it back in the environment inside the container, though not in `docker inspect`.
3. **They are only as good as the host.** Anyone who gets root on the host, or joins the `docker` group, reads the file.

**Recommendation: use file-based secrets for everything that supports them, starting with Postgres, and keep a `600` `.env` for genuinely non-secret configuration.** Do not spend effort on a secrets manager (Vault, Infisical, SOPS-age) at launch â€” the operational complexity is real and the threat it addresses (host compromise) is better answered by Â§7's rebuild plan.

### 6.4 The compose file, written correctly

```yaml
# /srv/foundit/docker-compose.yml
name: foundit

# --- Secrets: files on the host, mounted into /run/secrets/<name> ---
secrets:
  db_password:
    file: ./secrets/db_password
  nextauth_secret:
    file: ./secrets/nextauth_secret

x-hardening: &hardening
  restart: unless-stopped
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  logging:
    driver: json-file
    options: { max-size: "10m", max-file: "3" }

services:

  db:
    <<: *hardening
    image: pgvector/pgvector:pg17
    user: "999:999"                    # the postgres UID inside this image
    # NO ports: â€” reachable only from the backend network
    environment:
      POSTGRES_USER: foundit
      POSTGRES_DB: foundit
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password   # NOT POSTGRES_PASSWORD
      POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256"
    secrets:
      - db_password
    volumes:
      - ./data/pgdata:/var/lib/postgresql/data
    networks: [backend]
    # Postgres writes to more than its data dir, so read_only needs tmpfs help:
    read_only: true
    tmpfs:
      - /tmp:mode=1777
      - /run/postgresql:mode=0700,uid=999,gid=999
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U foundit -d foundit"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    <<: *hardening
    image: ghcr.io/amitlevavi234/foundit-app:${APP_TAG:-latest}
    user: "10001:10001"                # non-root, set by USER in the Dockerfile
    read_only: true
    tmpfs:
      - /tmp:mode=1777
      - /app/.next/cache:mode=0700,uid=10001,gid=10001
    environment:
      NODE_ENV: production
      DATABASE_URL_FILE: /run/secrets/db_password    # app reads the file itself
      PGHOST: db
      PGUSER: foundit
      PGDATABASE: foundit
    secrets:
      - db_password
      - nextauth_secret
    depends_on:
      db: { condition: service_healthy }
    networks: [backend, frontend]

  caddy:
    <<: *hardening
    image: caddy:2-alpine
    # The ONE service that is deliberately public.
    ports:
      - "0.0.0.0:80:80"
      - "0.0.0.0:443:443"
    cap_drop: [ALL]
    cap_add:
      - NET_BIND_SERVICE            # required to bind 80/443 as non-root
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./certs:/etc/caddy/certs:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [frontend]

networks:
  frontend:
  backend:
    internal: true                   # no route to the internet at all

volumes:
  caddy_data:
  caddy_config:
```

Every hardening attribute above is documented in the Compose specification ([Compose file: Services](https://docs.docker.com/reference/compose-file/services/)):

- `user` â€” "overrides the user used to run the container process. The default is set by the image, for example Dockerfile `USER`."
- `read_only` â€” "configures the service container to be created with a read-only filesystem."
- `cap_drop` â€” "specifies container capabilities to drop as strings."
- `cap_add` â€” "specifies additional container capabilities as strings."
- `security_opt` â€” "overrides the default labeling scheme for each container."
- `tmpfs` â€” "mounts a temporary file system inside the container."
- `privileged` â€” "configures the service container to run with elevated privileges." **Never set this.**
- `secrets` â€” "grants access to sensitive data defined by the secrets top-level element on a per-service basis."

Note that `secrets:` also takes `uid`, `gid` and `mode`, so a secret can be made readable only by the container's non-root user ([Compose file: Services](https://docs.docker.com/reference/compose-file/services/)):

```yaml
    secrets:
      - source: db_password
        uid: "10001"
        gid: "10001"
        mode: 0o400
```

### 6.5 How each hardening flag contains a compromised container

Assume an attacker achieves remote code execution inside the `app` container â€” a dependency vulnerability, a deserialisation bug, whatever. Here is what each flag takes away from them:

| Control | What the attacker loses |
|---|---|
| **`user: "10001:10001"`** (non-root) | Cannot write to `/etc`, `/usr`, or any root-owned path in the image. Cannot install packages. Cannot bind ports below 1024. Docker's docs: containers are "quite secure; especially if you run your processes as non-privileged users inside the container" ([Docker Engine security](https://docs.docker.com/engine/security/)). |
| **`read_only: true`** | Cannot drop a webshell, a cryptominer, or a persistence binary anywhere on disk. Everything they fetch dies with the container. This is the single most effective anti-persistence control available to you and it costs one line. |
| **`tmpfs` for writable paths** | The only writable locations are in RAM, wiped on restart, and `noexec` can be added (`mode=1777,noexec`). |
| **`cap_drop: [ALL]`** | No `CAP_NET_RAW` (no raw-socket scanning of your network), no `CAP_SYS_ADMIN`, no `CAP_DAC_OVERRIDE` (cannot bypass file permissions), no mounting. Docker already restricts capabilities â€” "By default Docker drops all capabilities except those needed", using an allowlist ([Docker Engine security](https://docs.docker.com/engine/security/)) â€” but that default set is still generous. `cap_drop: ALL` plus explicit `cap_add` is strictly tighter. |
| **`security_opt: no-new-privileges:true`** | Cannot gain privileges through a setuid binary. Kills a whole family of container escapes that depend on `su`/`sudo`/setuid helpers inside the image. |
| **`networks: backend.internal: true`** | For the `db` container: cannot exfiltrate data, cannot download a second stage, cannot join a botnet. It has no route off the box. |
| **No published port on `db`** | Cannot be reached from outside at all. The attacker must already be inside another container. |
| **No `docker.sock` mount** | Cannot become root on the host. See Â§6.6 â€” this is the big one. |
| **`restart: unless-stopped` + read-only** | Any foothold that is not in the image itself evaporates on the next restart, and containers restart on every deploy and reboot. |

Two things this does **not** protect against, stated plainly:

- **Data the app is supposed to have access to.** The attacker in `app` can read your database, because `app` can read your database. Container hardening limits lateral movement and persistence; it does not limit the application's own authority. That is an application-authorization problem (see `03-security-and-authorization.md`).
- **A kernel exploit.** Containers share the host kernel. `cap_drop` and non-root raise the bar considerably, but a kernel vulnerability escapes anyway â€” which is why Â§4's patching is not optional.

Enforce non-root in the image too, so a compose mistake cannot undo it:

```dockerfile
# Dockerfile (final stage)
RUN addgroup --system --gid 10001 nodejs \
 && adduser  --system --uid 10001 --ingroup nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
USER 10001
EXPOSE 3000
CMD ["node", "server.js"]
```

Verify what is actually running:

```bash
docker compose ps -q | while read -r id; do
  printf '%-20s user=%-12s readonly=%-6s caps=%s\n' \
    "$(docker inspect -f '{{.Name}}' "$id")" \
    "$(docker inspect -f '{{.Config.User}}' "$id")" \
    "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$id")" \
    "$(docker inspect -f '{{.HostConfig.CapDrop}}' "$id")"
done
# Any line showing user= (empty) is running as root inside the container. Fix it.
```

### 6.6 Never mount `docker.sock`

**Mounting `/var/run/docker.sock` into a container gives that container root on the host. There is no partial version of this and no safe read-only version of it.**

Docker's security documentation grounds why: *"only trusted users should be allowed to control your Docker daemon"*, and Docker allows sharing directories between host and container "without limiting the access rights of the container", so a container "could theoretically mount the entire host filesystem and modify it without restrictions" ([Docker Engine security](https://docs.docker.com/engine/security/)).

The attack is three commands. A container with the socket can ask the daemon to start a *new* container with `--privileged` and the host root filesystem bind-mounted at `/host`, then write to `/host/root/.ssh/authorized_keys` or `/host/etc/cron.d/`. Nothing about the first container's own `read_only`, `cap_drop` or non-root user matters â€” it is not doing the escaping, the daemon is, and the daemon runs as root.

The same reasoning means **adding a user to the `docker` group is equivalent to giving them passwordless root.** That is fine for `founditops`, who already has sudo. It is not fine for any service account, and it is not a way to "avoid using sudo".

Things that will ask you to mount the socket, and what to do instead:

| Wants the socket | Do this instead |
|---|---|
| **Watchtower / auto-updating containers** | Do not run it. Update deliberately (Â§4.6). Automatic image updates on a single production host is a self-inflicted outage waiting for a bad upstream tag. |
| **Traefik** (reads container labels for routing) | Use Caddy or nginx with a static config file. You have three services; service discovery is solving a problem you do not have. If you must use Traefik, put a socket proxy (`tecnativa/docker-socket-proxy`) in front, exposing only the read-only endpoints it needs. |
| **Portainer** | Access the host over SSH and use `docker` commands. If you want a UI badly enough, accept that Portainer is root-on-host and treat its credentials as root credentials. |
| **cAdvisor / monitoring** | Use the read-only socket-proxy pattern, or scrape metrics the app exports itself. |
| **CI/CD deploying via docker-in-docker** | Deploy over SSH: `ssh foundit 'cd /srv/foundit && docker compose pull && docker compose up -d'` with a dedicated, restricted key. |
| **Trivy scanning local images** (Â§4.6) | Scan the image in the registry instead: `trivy image ghcr.io/you/app:tag`. No socket needed. |

Audit for it:

```bash
grep -rn 'docker.sock' /srv/foundit/           # must return nothing
docker ps -q | xargs -r docker inspect --format \
  '{{.Name}}{{range .Mounts}} {{.Source}}{{end}}' | grep -i docker.sock
```

Add that grep to your weekly digest. It is a one-line check for a total-compromise condition.

### 6.7 Secrets that must never be on this server at all

| Secret | Where it belongs |
|---|---|
| Your Hetzner API token | Your laptop / password manager. If it must be on the server (for `hcloud firewall` automation), scope it to **read-only** or a single project, and treat its presence as a reason to rebuild if the server is compromised. |
| Cloudflare **Global API Key** | Nowhere, ever. Use a scoped **API Token** with only the permissions needed (e.g. `Zone:DNS:Edit` for a single zone), which can be revoked without affecting anything else. |
| Your GitHub personal access token | Use a **deploy key** (read-only, single repository) or a short-lived token from GitHub Actions OIDC. |
| Payment processor live keys | Only in the process that needs them, via file-based secrets, and rotate on any suspicion. |
| Your SSH **private** key | Your laptop only. Never on the server. If you need server-to-server access, generate a separate key on the server and authorise it narrowly. |

Rotation drill â€” run it once now, so you know how, before you need to do it at 3am:

```bash
# 1. New password
openssl rand -base64 32 | tr -d '\n' > /srv/foundit/secrets/db_password.new
# 2. Change it in Postgres
docker compose exec -T db psql -U foundit -c \
  "ALTER USER foundit PASSWORD '$(cat /srv/foundit/secrets/db_password.new)';"
# 3. Swap the file and restart the consumers
mv /srv/foundit/secrets/db_password{.new,}
chmod 600 /srv/foundit/secrets/db_password
docker compose up -d --force-recreate app
```

---


## 7. When it goes wrong

### 7.1 Signs of compromise on a small VPS

You are not going to spot a sophisticated attacker. You are going to spot the ordinary ones, and the ordinary ones are 95% of what actually happens to a box like this. Ordinary attackers monetise immediately, and monetisation is noisy.

**Loud signs â€” you will notice these without looking:**

| Sign | Check | What it usually means |
|---|---|---|
| CPU pinned at 100% with no traffic | `htop`, `docker stats` | Cryptominer. The single most common outcome of a compromised container. |
| Hetzner emails you about abuse / outbound attack traffic | your inbox | Your box is scanning or DDoSing others. Hetzner will suspend it. |
| Bandwidth bill or graph spikes | Hetzner Console â†’ Graphs | Exfiltration, a miner's pool traffic, or your box being used as a proxy. |
| Site suddenly slow or 502ing | uptime monitor | Could be anything; combined with high CPU it is a miner. |
| Disk full | `df -h` | Logs, or a staging area for stolen data, or dumped payloads. |
| Cannot log in with your key | â€” | Someone changed `authorized_keys`. Go straight to Â§7.3. |
| A ransom note in your database | â€” | Exposed Postgres/Redis. See Â§8.8 â€” this is *the* self-hosting disaster. |

**Quiet signs â€” these need looking, which is what the weekly checklist in Â§5.4 is for:**

```bash
# Unexpected listening sockets â€” the highest-value single check
sudo ss -tlnp

# Outbound connections you did not initiate
sudo ss -tnp state established '( dport != :443 and dport != :80 )'

# Processes with no package behind them, running from odd paths
ps aux --sort=-%cpu | head -20
ls -la /tmp /dev/shm /var/tmp        # classic drop locations; should be near-empty

# Users who should not exist, or accounts that gained a shell/UID 0
awk -F: '$3 < 1000 && $7 !~ /(nologin|false)/ {print}' /etc/passwd
awk -F: '$3 == 0 {print $1}' /etc/passwd     # must print only "root"
getent group sudo docker

# SSH keys you did not add
sudo cat /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys

# Persistence: cron, systemd timers, shell profiles
sudo crontab -l; sudo ls -la /etc/cron.*/ /var/spool/cron/crontabs/
systemctl list-timers --all
sudo grep -rn 'curl\|wget\|base64\|/dev/tcp' /etc/profile.d/ /root/.bashrc /home/*/.bashrc

# Modified package files
sudo debsums -c                     # expect no output

# Logins
last -20; sudo lastb -20
sudo journalctl -u ssh --since "30 days ago" | grep 'Accepted'

# Container-level
docker ps -a                        # containers you did not start
docker images                       # images you did not pull
docker inspect $(docker ps -q) --format '{{.Name}} {{.Config.Image}} {{.Config.Cmd}}'
```

**Two signs specific to your architecture:**

1. **Traffic arriving from a non-Cloudflare IP on 80/443.** With Â§3 in place this should be impossible; if it happens, your allowlist broke. Log it:
   ```bash
   sudo iptables -I FOUNDIT-CF 1 -p tcp -m conntrack --ctorigdstport 443 \
     -m limit --limit 5/min -j LOG --log-prefix "CF-BYPASS: "
   sudo journalctl -k | grep CF-BYPASS
   ```
2. **Any connection to Postgres from outside the `backend` network.**
   ```bash
   docker compose exec -T db psql -U foundit -c \
     "SELECT client_addr, usename, state, backend_start FROM pg_stat_activity WHERE client_addr IS NOT NULL;"
   # every client_addr must be in your backend network's subnet (172.x)
   ```

### 7.2 Rebuild, do not clean

**Principle: if the host is compromised, you cannot trust anything on it, including the tools you would use to check whether you cleaned it. Destroy the server and build a new one.**

The reasoning, in a form worth internalising:

- Root-level malware modifies the very binaries you would use to look for it. `ps`, `ls`, `netstat` and `find` are the classic targets. A rootkit's entire job is to make your inspection tools lie.
- You cannot prove absence. You can find three backdoors and be confident about none of them being the last one. "I cleaned it" always means "I stopped finding things", which is a statement about your search, not about the server.
- Attackers plant multiple persistence mechanisms *precisely because* defenders find one and stop. A cron job, an SSH key, a systemd timer, a modified `.bashrc`, a container image, a kernel module â€” you must find all of them; they need one to survive.
- **Rebuilding is faster.** Cleaning is open-ended, stressful, and produces a server you never fully trust again. Rebuilding is a known, bounded procedure you have rehearsed. On a Hetzner Cloud VPS with your configuration in git, it is under an hour.

The one exception: if this is a genuinely serious incident (customer data, legal exposure), **snapshot the compromised disk before destroying it** so a professional can examine it later, and do not power it off until you have â€” some evidence lives only in memory.

```bash
# Preserve evidence: Hetzner Console â†’ your server â†’ Snapshots â†’ Take Snapshot
# Label it "COMPROMISED-2026-09-10-do-not-boot"
```

### 7.3 The rebuild procedure, target: under one hour

**Phase 0 â€” contain (2 minutes).** Do this before anything else.

```
Hetzner Console â†’ your server â†’ Firewalls
  â†’ remove ALL inbound rules except SSH from your own IP
```
This severs the attacker's access without destroying evidence or state, and without touching the machine (which the attacker may be watching). Then, in Cloudflare, enable "Under Attack" mode or pause the zone so users see a maintenance page rather than a compromised app.

**Phase 1 â€” capture what you need (10 minutes).**

```bash
# Take a Hetzner snapshot first (Console), then, if you can still trust a shell:
ssh foundit
cd /srv/foundit
docker compose exec -T db pg_dump -U foundit -Fc foundit > /tmp/final-dump.pgdump
# Copy it OFF the box, to your laptop:
exit
scp foundit:/tmp/final-dump.pgdump ./final-dump.pgdump
```
âš ï¸ **Treat this dump as potentially tainted.** Prefer your last known-good scheduled backup (Â§7.4) and accept the data loss. Use the final dump only to reconcile what changed in between, and inspect it before restoring â€” an attacker with database write access may have modified rows.

**Phase 2 â€” build the new server (15 minutes).**

1. Create a new Hetzner server, **new IP**, following Â§1.1â€“1.8 (use the cloud-init from Â§1.11 to compress this to minutes).
2. Attach the firewall from Â§2.2.
3. Install Docker, apply `/etc/docker/daemon.json` from Â§2.4.3.
4. Apply the `DOCKER-USER` script from Â§3.4 and enable its unit and timer.
5. Configure `unattended-upgrades` (Â§4) and `fail2ban` (Â§5.2).

**Phase 3 â€” restore (15 minutes).**

```bash
git clone git@github.com:amitlevavi234/foundit-infra.git /srv/foundit
cd /srv/foundit

# Recreate ALL secrets from scratch. Every credential the old box held is burned.
mkdir -p secrets && chmod 700 secrets
umask 077
openssl rand -base64 32 | tr -d '\n' > secrets/db_password
openssl rand -hex 32   | tr -d '\n' > secrets/nextauth_secret
# ...plus: new Cloudflare API token, new GitHub deploy key, new third-party API keys.

docker compose up -d db
docker compose exec -T db pg_restore -U foundit -d foundit --clean --if-exists \
  < /path/to/last-known-good.pgdump
docker compose up -d
```

**Phase 4 â€” cut over (10 minutes).**

1. Update the Cloudflare A record to the new IP. Cloudflare propagation is near-instant since it is proxied.
2. Verify with Â§8's external checks.
3. Turn off "Under Attack" mode.
4. **Destroy the old server.** Not "stop" â€” destroy. Keep only the labelled forensic snapshot.

**Phase 5 â€” rotate everything the old server ever saw (do not skip).**

- Database passwords âœ… (done in Phase 3)
- Every third-party API key the server held
- Cloudflare API token â†’ revoke and reissue
- Hetzner API token â†’ revoke and reissue
- GitHub deploy key â†’ delete and regenerate
- **Your own SSH key**, if there is any chance the private key was on the server (it should never have been)
- Any user session tokens / JWT signing secrets â€” invalidating all sessions is correct here
- If user passwords were in a database the attacker read: force a reset, and notify users. This may be a legal obligation depending on jurisdiction.

### 7.4 What must exist beforehand for that hour to be possible

**This is the section to act on today.** Every item is cheap now and impossible to retrofit during an incident.

| # | Must exist | How | Verify |
|---|---|---|---|
| 1 | **Infrastructure in git** â€” `docker-compose.yml`, `Caddyfile`, Dockerfiles, systemd units, the `foundit-cf-firewall.sh` script | A **private** repo, `foundit-infra`. Secrets never in it (Â§6.1 `.gitignore`). | `git clone` it to a scratch directory and confirm nothing is missing. |
| 2 | **Automated, off-server database backups** | `pg_dump -Fc` nightly, pushed to object storage in a **different provider** (Hetzner Storage Box, Backblaze B2, Cloudflare R2). Not on the same VPS; not on the same account if you can help it. | Â§7.5 |
| 3 | **A tested restore** | Actually restore last night's dump into a scratch container, monthly. | `docker run --rm -d --name restoretest postgres:17 && pg_restore ...` then count rows. |
| 4 | **Hetzner automatic backups enabled** | +20% of server cost. "copies of a server's disk that are created automatically on a daily basis", up to 7 slots, oldest deleted when full ([Hetzner: Backups and snapshots](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/)). | Console shows 7 dated backups. |
| 5 | **A pre-incident snapshot before every risky change** | Console â†’ Snapshots â†’ Take Snapshot. Snapshots are "created manually" and persist until deleted ([Hetzner: Backups and snapshots](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/)). | Delete old ones; the default cap is 30 across all projects. |
| 6 | **A second SSH key, on a second device** | Added at server creation (Â§1.2 â€” you cannot add one via the Console afterwards). | Log in from the second device once, then leave it alone. |
| 7 | **Your secrets in a password manager**, structured | One entry per secret with the rotation procedure in the notes. | Open it and read it; can you rebuild from what is written there? |
| 8 | **DNS you control, with a short TTL** | Cloudflare, proxied. Changing the origin IP is one field. | â€” |
| 9 | **The rebuild runbook, printed or in the password manager** | Â§7.3, saved somewhere not on the server. | â€” |
| 10 | **An uptime monitor with phone alerts** | UptimeRobot / Better Stack free tier. | Stop the app deliberately; confirm your phone buzzes. |

âš ï¸ **Two Hetzner limitations that matter for backups:** neither backups nor snapshots include attached **Volumes** ([Hetzner: Backups and snapshots](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/)). If you ever move `pgdata` to a Volume for space, it stops being covered â€” you would need Volume snapshots separately. And a disk-image backup of a *compromised* server is a backup of the compromise; that is why item 2 (application-level database dumps, versioned, off-site) is the one that actually saves you, and items 4â€“5 are conveniences.

### 7.5 The backup script

```bash
sudo tee /usr/local/sbin/foundit-backup.sh > /dev/null <<'BACKUP'
#!/bin/bash
set -euo pipefail
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="/srv/foundit/backups/foundit-${TS}.pgdump"
mkdir -p /srv/foundit/backups

docker compose -f /srv/foundit/docker-compose.yml exec -T db \
  pg_dump -U foundit -Fc foundit > "$OUT"

# Encrypt before it leaves the machine. Public key only lives here;
# the private key lives in your password manager.
age -r "$(cat /srv/foundit/backup-recipient.age.pub)" -o "${OUT}.age" "$OUT"
rm -f "$OUT"

# Push off-site. rclone remote configured for Backblaze B2 / R2 / Storage Box.
rclone copy "${OUT}.age" "offsite:foundit-backups/" --checksum

# Keep 14 days locally, everything remotely (lifecycle rules handle remote retention)
find /srv/foundit/backups -name '*.age' -mtime +14 -delete

logger -t foundit-backup "backup ${TS} complete ($(stat -c%s "${OUT}.age") bytes)"
BACKUP
sudo chmod 700 /usr/local/sbin/foundit-backup.sh
```

Schedule it at 03:00 with a systemd timer (same pattern as Â§3.5), and â€” critically â€” **alert on failure**, because a backup job that has silently failed for six weeks is the actual disaster:

```ini
# /etc/systemd/system/foundit-backup.service
[Unit]
Description=Nightly Foundit database backup
OnFailure=foundit-alert@%n.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/foundit-backup.sh
```

```ini
# /etc/systemd/system/foundit-alert@.service
[Unit]
Description=Alert on failure of %i
[Service]
Type=oneshot
ExecStart=/bin/sh -c '/usr/bin/systemctl status %i | mail -s "FOUNDIT FAILED: %i" you@example.com'
```

Also add a **dead-man's switch**: have the backup script ping a healthchecks.io (free tier) URL on success. If the ping stops arriving, you get an email. That catches "the server is off" and "cron is broken", which failure alerts cannot.

---

## 8. Verification â€” proving from outside that only 80/443 are open

Everything in sections 2 and 3 is a claim about intent. This section is the proof. **Run it after initial setup, after every firewall change, and quarterly.**

### 8.1 The single most important test

From a machine that is **not** your server and **not** on your home network â€” a friend's laptop, a phone hotspot, a $5 throwaway VPS elsewhere, or a free cloud shell:

```bash
# Full TCP scan of every port. Takes a few minutes. This is the test.
nmap -Pn -sS -p- --min-rate 1000 YOUR.SERVER.IP

# UDP, top ports (slower)
sudo nmap -Pn -sU --top-ports 50 YOUR.SERVER.IP

# IPv6, if the server has a public IPv6 address â€” DO NOT SKIP THIS
nmap -6 -Pn -sS -p- YOUR.SERVER.IPV6
```

**Expected result if Â§2 and Â§3 are correct:**

```
PORT      STATE    SERVICE
52242/tcp filtered ssh          <- filtered, because Hetzner allows only your IP
80/tcp    filtered http         <- filtered, because only Cloudflare IPs are allowed
443/tcp   filtered https        <- filtered
All other ports: filtered
```

`filtered` means the packet was dropped with no response â€” the correct outcome. `closed` means something answered with a RST, which means the packet reached your machine; acceptable but less good. **`open` on anything other than 80/443 from a Cloudflare IP is a finding.**

**The specific ports that must NOT be open, with what it would mean:**

| Port | Service | If open |
|---|---|---|
| **5432** | PostgreSQL | **Stop everything.** Your database is public. Go to Â§2.4.3 Fix 1 now, then assume it has been read and rebuild (Â§7). |
| **6379** | Redis | Same. Redis with no auth is trivially exploited into RCE. |
| **27017** | MongoDB | Same. |
| **3000** | Next.js dev/direct | Your app is reachable bypassing Cloudflare â€” no WAF, no rate limiting. |
| **8080 / 8000** | app / admin panel | Same. |
| **2375 / 2376** | Docker API | Total compromise. Anyone can start a privileged container. |
| **9000** | Portainer / php-fpm | Admin interface exposed. |
| **25 / 587** | SMTP | You are an open relay or about to be. |

### 8.2 Prove the Cloudflare-only restriction works

```bash
# From a non-Cloudflare machine, hit the ORIGIN IP directly.
curl -v --max-time 10 --resolve foundit.app:443:YOUR.SERVER.IP https://foundit.app/
# Expected: "Connection timed out" or "No route to host" â€” NOT a page.

curl -v --max-time 10 http://YOUR.SERVER.IP/
# Expected: timeout.

# Through Cloudflare it must still work:
curl -sI https://foundit.app/ | head -3
# Expected: HTTP/2 200, with a "cf-ray" header proving it went via Cloudflare.
```

If the first two return your site, the origin lock is not working. In order, check: the Hetzner firewall rules; then `sudo iptables -L FOUNDIT-CF -n --line-numbers` (is the chain populated? is it jumped to from `DOCKER-USER`?); then whether the request is arriving via a route you did not consider (IPv6!).

### 8.3 Prove Authenticated Origin Pulls is enforcing

```bash
# From anywhere, if you can reach the origin at all (e.g. from a Cloudflare IP
# range, or temporarily from your own allowlisted address):
curl -vk --resolve foundit.app:443:YOUR.SERVER.IP https://foundit.app/ 2>&1 | tail -20
# Expected: a TLS alert about a missing client certificate, or HTTP 400
# "No required SSL certificate was sent". NOT your homepage.
```

### 8.4 Prove SSH is key-only

```bash
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password \
    -p 52242 founditops@YOUR.SERVER.IP
# Expected: "Permission denied (publickey)." â€” the server never even prompts.

ssh -p 52242 root@YOUR.SERVER.IP
# Expected: "Permission denied (publickey)." â€” root login refused.
```

And from the server, confirm the *effective* configuration rather than what you think you wrote:

```bash
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|kbdinteractive|allowusers|maxauthtries|allowtcpforwarding|^port'
```

Expected: `permitrootlogin no`, `passwordauthentication no`, `kbdinteractiveauthentication no`, `allowusers founditops`, `maxauthtries 3`, `allowtcpforwarding no`, `port 52242`.

### 8.5 On-server confirmation (necessary, not sufficient)

```bash
# Nothing on a public address except the proxy
sudo ss -tlnp | grep -vE '127\.0\.0\.1|\[::1\]'

# No container publishing to 0.0.0.0 except caddy
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '0\.0\.0\.0|:::' 

# The Cloudflare chain is live and jumped to
sudo iptables -L DOCKER-USER -n --line-numbers | head
sudo iptables -L FOUNDIT-CF  -n | wc -l         # should be ~35 lines

# ufw is on
sudo ufw status verbose

# No docker.sock mounts
docker ps -q | xargs -r docker inspect --format '{{.Name}}{{range .Mounts}} {{.Source}}{{end}}' | grep -i docker.sock

# Every container non-root and read-only
docker compose ps -q | xargs -r -I{} docker inspect -f \
  '{{.Name}} user={{.Config.User}} ro={{.HostConfig.ReadonlyRootfs}}' {}
```

### 8.6 Third-party views of your server

| Tool | URL | What it tells you |
|---|---|---|
| **Shodan** | `https://www.shodan.io/host/YOUR.SERVER.IP` | What internet-wide scanners have already indexed about you. **Check this. It is what an attacker checks.** |
| **Censys** | `https://search.censys.io/hosts/YOUR.SERVER.IP` | Same, with certificate detail. |
| **crt.sh** | `https://crt.sh/?q=foundit.app` | Every certificate ever issued for your domain â€” i.e. every subdomain you may have forgotten, one of which may be grey-clouded and leaking your origin IP. |
| **SSL Labs** | `https://www.ssllabs.com/ssltest/analyze.html?d=foundit.app` | TLS configuration grade. Aim for A. |
| **Mozilla Observatory** | `https://developer.mozilla.org/en-US/observatory/analyze?host=foundit.app` | HTTP security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy). Free, actionable, and directly relevant to the app rather than the host. |
| **DNS history** | SecurityTrails / ViewDNS | Whether your pre-Cloudflare origin IP is in the historical record. If your *current* IP is there, that is a reason to change it. |

### 8.7 A repeatable verification script for your laptop

```bash
#!/bin/bash
# save as verify-foundit.sh on your LAPTOP, run from a non-allowlisted network
IP="YOUR.SERVER.IP"; DOMAIN="foundit.app"; SSH_PORT="52242"
FAIL=0
say(){ printf '%-52s %s\n' "$1" "$2"; }

echo "=== Foundit external verification â€” $(date -u) ==="

for p in 5432 6379 27017 3000 8080 8000 2375 2376 9000 25; do
  if nc -z -w3 "$IP" "$p" 2>/dev/null; then say "port $p" "OPEN  <-- FAIL"; FAIL=1
  else say "port $p" "closed/filtered  OK"; fi
done

if curl -s --max-time 8 --resolve "$DOMAIN:443:$IP" "https://$DOMAIN/" -o /dev/null; then
  say "direct-to-origin HTTPS" "REACHABLE  <-- FAIL"; FAIL=1
else say "direct-to-origin HTTPS" "blocked  OK"; fi

if curl -sI --max-time 8 "https://$DOMAIN/" | grep -qi '^cf-ray'; then
  say "site via Cloudflare" "OK"
else say "site via Cloudflare" "NOT SERVING  <-- FAIL"; FAIL=1; fi

if ssh -o BatchMode=yes -o ConnectTimeout=5 -o PubkeyAuthentication=no \
       -o PreferredAuthentications=password -p "$SSH_PORT" \
       nosuchuser@"$IP" 2>&1 | grep -q 'Permission denied (publickey)'; then
  say "SSH password auth" "refused  OK"
else say "SSH password auth" "CHECK MANUALLY"; fi

echo; [ "$FAIL" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "FAILURES PRESENT â€” see above"
exit "$FAIL"
```

---


## 9. The mistakes people make self-hosting for the first time

Ranked by how likely each is to end the project. Each entry gives the mistake, why it happens, how to detect it in one command, and the fix.

### 9.1 Postgres bound to `0.0.0.0` â€” the one that ends companies

**The mistake.** `ports: - "5432:5432"` in `docker-compose.yml`. It reads like "let my app reach the database"; it means "publish PostgreSQL on every address of this machine, including the public IPv4."

**Why it happens.** Every quickstart tutorial has it, because tutorials are written for laptops where `0.0.0.0` is behind a home router. On a VPS, `0.0.0.0` is the internet. Docker's own docs describe this default as *"insecure by default"* ([Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)).

**Detect.**
```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '0\.0\.0\.0:(5432|6379|27017|3306)'
```
Any output is an emergency.

**Fix.** Delete the `ports:` block entirely (Â§2.4.3 Fix 1). If you truly need it, `"127.0.0.1:5432:5432"`, plus the daemon default in Fix 3 so the next person's mistake is harmless.

**If it was exposed:** assume the data was read. Postgres with a weak password is cracked in seconds; even with a strong one, an unpatched Postgres has had remotely exploitable bugs. Rotate everything and rebuild (Â§7).

### 9.2 Believing ufw protects Docker ports

**The mistake.** `sudo ufw default deny incoming` + `sudo ufw status` showing `active`, and concluding the box is closed. It is not, for anything Docker published â€” Docker "routes container traffic in the `nat` table, which means that packets are diverted before it reaches the `INPUT` and `OUTPUT` chains that ufw uses" ([Docker: Docker and ufw](https://docs.docker.com/engine/network/packet-filtering-firewalls/)).

**Why it happens.** ufw's output is confident and unambiguous, and it is telling the truth about the chains it controls. Nothing warns you that a whole category of traffic never reaches those chains. It is a false-confidence bug, which is the most dangerous kind.

**Detect.** Only an external scan settles it (Â§8.1). On-box, compare `sudo ufw status` against `docker ps --format '{{.Ports}}'` â€” where they disagree, Docker wins.

**Fix.** Â§2.4.3, Fixes 1â€“4. And re-read: **ufw is still worth running** â€” it protects the host's own services, sshd included. It is just not the thing protecting your containers.

### 9.3 Root SSH with a password

**The mistake.** Creating the server with a root password (or resetting to one and leaving it), and never touching `sshd_config`. OpenSSH's defaults are `PermitRootLogin prohibit-password` and â€” the killer â€” `PasswordAuthentication yes` ([sshd_config(5)](https://man.openbsd.org/sshd_config)).

**Why it happens.** It works immediately, and the failure is invisible. Nothing tells you that thousands of automated attempts per day are hitting the box.

**Detect.**
```bash
sudo sshd -T | grep -E 'permitrootlogin|passwordauthentication|kbdinteractive'
sudo journalctl -u ssh --since "24 hours ago" | grep -c 'Failed password'
```

**Fix.** Â§1.7. And note that `PasswordAuthentication no` alone is a half-fix â€” `KbdInteractiveAuthentication yes` (also the default) can allow password prompts through PAM on some configurations. Turn both off.

### 9.4 No fail2ban â€” and, worse, fail2ban installed but silently doing nothing

**The mistake with a twist.** The classic mistake is not installing it. The *more common* modern mistake is installing it, seeing `active (running)`, and never checking that it can see any logs. Recent Debian/Ubuntu images often ship without `rsyslog`, so `/var/log/auth.log` never exists, and a jail with `backend = auto` watches nothing forever.

**Detect.**
```bash
sudo fail2ban-client status sshd
# "Total failed: 0" after weeks of a public SSH port means it is BLIND, not safe.
```

**Fix.** `backend = systemd` (Â§5.2), then deliberately fail four logins from a phone hotspot and confirm you get banned.

### 9.5 Secrets in the compose file, committed to a public repo

**The mistake.** `POSTGRES_PASSWORD: hunter2` inline in `docker-compose.yml`, `git add .`, public repo. Or a `.env` committed before `.gitignore` existed.

**Why it is worse than it sounds.** GitHub is scanned continuously by automated credential harvesters. Exposure is measured in **minutes**, not days. And `git rm` does not help: **the secret remains in the repository history forever** and in every fork, clone and cached view.

**Detect.**
```bash
git log --all --full-history -p -- '*.env' 'docker-compose.yml' | grep -iE 'password|secret|api[-_]?key|token'
git log --all --oneline -- .env secrets/
```

**Fix.** In this order, and the order matters:
1. **Rotate the secret first.** Immediately. It is compromised the moment it was pushed, and rewriting history does not un-compromise it.
2. Then clean the repo (`git filter-repo`, or make it private and rotate everything regardless).
3. Then add `.gitignore` (Â§6.1) and use file-based secrets (Â§6.3â€“6.4).
4. Enable GitHub secret scanning and push protection on the repo.

**Prevent it structurally:** install a pre-commit hook so it cannot happen again.
```bash
pip install --user detect-secrets   # or: brew install gitleaks
detect-secrets scan > .secrets.baseline
# add to .pre-commit-config.yaml and run: pre-commit install
```

### 9.6 Running everything as root inside containers

**The mistake.** No `USER` in the Dockerfile, no `user:` in compose. Most images default to root, and root inside a container is a much shorter distance from root on the host than people assume.

**Why it happens.** Everything just works as root. Permission errors are a real friction that non-root introduces, and "add `user: root`" makes them disappear.

**Detect.**
```bash
docker compose ps -q | xargs -r -I{} docker inspect -f '{{.Name}} user=[{{.Config.User}}]' {}
# user=[] means root
docker compose exec app id     # uid=0(root) is the finding
```

**Fix.** Â§6.4/Â§6.5. Docker's own conclusion: containers are "quite secure; especially if you run your processes as non-privileged users inside the container" ([Docker Engine security](https://docs.docker.com/engine/security/)). Pair `user:` with `read_only: true`, `cap_drop: [ALL]` and `no-new-privileges:true`.

**Related and worse:** `privileged: true`, and mounting `/var/run/docker.sock` (Â§6.6). Both are root-on-host.

### 9.7 No monitoring, so a breach is invisible

**The mistake.** Nothing watches the server. You find out it was compromised when Hetzner emails you about abuse traffic, or when a user says the site is down, or â€” most commonly â€” never.

**Why it happens.** Monitoring feels like a nice-to-have next to shipping features, and the free tiers require an afternoon of setup.

**Detect.** Ask yourself: *if my server were mining cryptocurrency right now, how would I find out?* If you cannot name the mechanism, you do not have one.

**Fix â€” the 30-minute version that covers most of it:**
1. **Uptime monitor** hitting `/healthz` every 5 minutes with phone alerts. Free. Do this one first.
2. **The weekly digest email** from Â§5.4.
3. **`OnFailure=` alerts** on your backup and firewall systemd units (Â§7.5).
4. **Healthchecks.io dead-man's switch** on the backup job.
5. **Cloudflare's analytics dashboard** for traffic anomalies â€” it is already there and it has real client IPs.

Point 1 alone catches most real incidents, because attackers who monetise tend to break things.

### 9.8 Underestimating what a public IPv4 attracts

**The reality.** A new Hetzner IPv4 address begins receiving unsolicited traffic within **minutes** of being assigned. Not because anyone is targeting you â€” because the entire IPv4 space is scanned continuously. Shodan alone added "1,000+ ports" to its scanning list in 2025 and offers monitoring that reports "what you have connected to the Internet within your network range within 5 minutes" ([Shodan Book: 2025 release notes](https://book.shodan.io/release-notes/2025/), [Shodan Monitor](https://monitor.shodan.io/)). Shodan and Censys are the *polite*, publicly documented scanners; the impolite ones are far more numerous and do not publish release notes.

**What this means concretely:**

- An exposed Redis with no password is typically found and exploited within **hours**, often much less. Redis is the archetypal case: no authentication by default in older versions, and a documented path from "can write keys" to "can write a crontab or an SSH key" â€” i.e. remote code execution as whoever runs redis.
- An exposed Postgres or MongoDB draws credential-stuffing and, if reachable, the well-known "your data has been backed up, pay X BTC" ransom-wipe. Automated ransom campaigns against exposed databases have run continuously for years.
- SSH on port 22 with passwords enabled receives thousands of credential attempts per day from day one.
- None of this requires your domain to exist, your site to launch, or anyone to know who you are. **You do not have to be a target to be compromised.** You just have to be reachable.

**The lesson for how you work:** there is no "I'll harden it after launch" window. The window between `CREATE & BUY NOW` and the first hostile packet is measured in minutes. That is why Â§1.2 attaches the firewall *at creation*, and why Â§1.11's cloud-init exists.

### 9.9 Six more that show up constantly

| Mistake | Why it bites | Fix |
|---|---|---|
| **Cloudflare SSL mode set to `Flexible`** | Cloudflareâ†’origin traffic is plain HTTP across the public internet. The padlock is a lie. | `Full (strict)` + Cloudflare Origin CA cert (Â§3.7). |
| **A grey-clouded DNS record** (`staging.`, `mail.`, `direct.`) | Publishes the origin IP in DNS, defeating the whole of Â§3 in one record. | `dig +short <each subdomain>`; proxy everything or move it. |
| **`chmod 777` to fix a permissions error** | Usually applied to a data volume or a secret file, and never undone. | `chown` to the container's UID instead; Â§6.4 uses explicit `user:`. |
| **Postgres data in a container layer, not a volume** | `docker compose down` deletes the database. Not a breach; still fatal. | Named volume or bind mount, plus Â§7.5 backups. |
| **No log rotation** | Docker JSON logs grow without limit until the disk fills and Postgres stops. | `log-opts max-size/max-file` in `daemon.json` (Â§2.4.3). |
| **Testing the firewall from an existing SSH session** | Hetzner: "Existing connections established before the Firewall was updated will remain active" ([Hetzner: Firewall FAQ](https://docs.hetzner.com/cloud/firewalls/faq/)). You "verify" with a connection the new rules never touched. | Always test from a **new** connection on a **different** network. |

---

## 10. Maintenance checklist

Print this. Put it in your password manager. The whole point of sections 1â€“9 is that this list is short.

### Every week â€” 10 minutes, mostly reading one email

- [ ] **Read the weekly digest email** (Â§5.4). If it did not arrive, that is itself the finding â€” investigate.
- [ ] In the digest, specifically look at:
  - [ ] **`ss -tlnp`** â€” anything on `0.0.0.0` other than 80/443? *(the Â§2.4 regression check)*
  - [ ] **Published container ports** â€” any new `0.0.0.0:` entry?
  - [ ] **SSH logins** â€” any `Accepted publickey` you do not recognise?
  - [ ] **Disk usage** â€” under 80%?
  - [ ] **`Reboot required?`** â€” if yes and it has been yes for days, automatic reboots are broken.
- [ ] **Uptime monitor** shows no unexplained gaps.
- [ ] `sudo fail2ban-client status sshd` â€” running and counting.

### Every month â€” 45 minutes

- [ ] **Rebuild and redeploy containers** (Â§4.6) â€” `docker compose pull && docker compose build --pull && docker compose up -d`. *The most-skipped, most-important task.*
- [ ] **Scan images for CVEs** â€” `docker scout cves` or `trivy image <registry-image>`.
- [ ] **Restore a backup into a scratch container and count rows** (Â§7.4 item 3). An untested backup is a hope.
- [ ] `sudo debsums -c` â€” expect no output.
- [ ] `sudo apt update && apt list --upgradable` â€” apply the `-updates` packages you deliberately excluded from unattended upgrades (Â§4.3).
- [ ] `sudo aide.wrapper --check` â€” review changes; re-baseline after legitimate ones.
- [ ] Review Cloudflare analytics for traffic anomalies.
- [ ] `docker system prune -af --volumes` â€” **read what it will delete first**; the `--volumes` flag can remove data.
- [ ] Confirm the off-site backup bucket actually contains the last 30 nightly files.

### Every quarter â€” 90 minutes

- [ ] **Run the full external verification** (Â§8) from a network you have never used for this server.
- [ ] Check `https://www.shodan.io/host/YOUR.SERVER.IP` â€” what does the internet know about you?
- [ ] Check `https://crt.sh/?q=foundit.app` for subdomains you forgot, then `dig +short` each one for grey-clouded records.
- [ ] Compare `https://www.cloudflare.com/ips/` against `/var/lib/foundit/cloudflare-ips-v4.txt`.
- [ ] **Do a full rebuild drill**: build a new server from the runbook and your backups into a scratch Hetzner project, confirm the site comes up, then destroy it. Time it. If it takes more than 90 minutes, something in Â§7.4 is missing.
- [ ] Rotate the database password (Â§6.7 drill).
- [ ] Review who has access: SSH keys in `authorized_keys`, Hetzner project members, Cloudflare account members, GitHub collaborators.
- [ ] Confirm the Hetzner backups list shows 7 recent dated entries.
- [ ] `sudo sshd -T | grep -E 'permitrootlogin|passwordauthentication'` â€” confirm a package upgrade has not reset anything.

### Every year â€” half a day

- [ ] Plan the **OS upgrade** (Ubuntu 24.04 â†’ 26.04 LTS, or Debian point release). Do it on a *new* server from your runbook, not in place. This is the rebuild drill with a real payoff.
- [ ] Rotate every credential: API tokens, deploy keys, SSH keys.
- [ ] Re-read this document. Some of it will be out of date.
- [ ] Consider migrating to Cloudflare Tunnel (Â§3.8) if you have not already.

### After every change to firewall, SSH or Docker networking â€” always

- [ ] Second SSH session still works (opened *after* the change).
- [ ] `curl -sI https://foundit.app/ | head -1` returns 200.
- [ ] `docker ps --format '{{.Names}}\t{{.Ports}}'` â€” no new `0.0.0.0` publishing.
- [ ] External check of ports 5432/6379/3000 (Â§8.7 script).
- [ ] Snapshot taken **before** the change, deleted after it is proven good.

---

