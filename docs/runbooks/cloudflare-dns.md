# Cloudflare DNS + TLS — `hulkstein.com` → Hetzner

How to point `hulkstein.com` (purchased at Cloudflare Registrar) at the
Hetzner VPS that hosts apphub in production, with **end-to-end TLS** via
Cloudflare Full (Strict) and a Cloudflare Origin Certificate.

## Target topology

```
Browser ── HTTPS ──▶ Cloudflare edge ── HTTPS ──▶ Hetzner :443 (nginx)
                       │                         (Cloudflare Origin Cert)
                       └── *.hulkstein.com + hulkstein.com (Universal SSL)
```

- Browser ↔ Cloudflare: TLS terminated at CF edge using Universal SSL
  (`hulkstein.com` and `*.hulkstein.com`). Free, auto-renewed.
- Cloudflare ↔ Hetzner: TLS using a **Cloudflare Origin Certificate**
  installed on the origin. ECDSA, 15-year validity, only trusted by
  Cloudflare. SSL mode = **Full (Strict)** — CF refuses any other cert.
- Origin nginx listens on `:80` (catch-all + dev) and `:443` (production
  traffic via CF). The `:443` listener is activated by the production
  compose override only.

> ⚠️ **Cloudflare removed the "Flexible" SSL mode** for sites created
> after 2024 — only `Full` and `Full (Strict)` are available. Both
> require TLS on the origin (port 443). This runbook walks through the
> Full (Strict) setup; do not pick `Full` (non-strict) — same cost,
> weaker guarantee.

## Pre-requisites

- Hetzner VPS reachable on a public IPv4 (currently `178.104.131.141`).
- `hulkstein.com` registered at Cloudflare Registrar (or DNS delegated
  to Cloudflare nameservers). Confirm under
  `Overview → "Cloudflare is using your zone"`.
- The deploy on the VPS must include the commits that introduce the
  TLS-aware nginx config (`tls-listen.prod.conf`, `443:443` in
  `docker-compose.prod.yml`, `PLATFORM_PUBLIC_DOMAIN=hulkstein.com`).
- Root SSH to the VPS so we can drop the origin cert files.

## Step 1 — DNS records (Cloudflare UI)

`hulkstein.com → DNS → Records → Add record`

| Type | Name | Content            | Proxy        | TTL  |
|------|------|--------------------|--------------|------|
| A    | `@`  | `178.104.131.141`  | 🟠 Proxied   | Auto |
| A    | `*`  | `178.104.131.141`  | 🟠 Proxied   | Auto |

The wildcard covers every app subdomain (`aikikan.hulkstein.com`,
`splitpay.hulkstein.com`, `console.hulkstein.com`, …) and every
tenant subdomain rendered by `platform/tenant-config` at runtime.

Verification (purely DNS):

```bash
dig hulkstein.com           +short   # → CF IPs (not 178.104.131.141)
dig aikikan.hulkstein.com   +short   # → same CF IPs
```

If `dig` still returns `178.104.131.141`, the proxy is off (grey cloud)
— flip it to orange.

## Step 2 — Generate the Cloudflare Origin Certificate

`SSL/TLS → Origin Server → Create Certificate`:

| Field | Value |
|---|---|
| Private key type | **ECDSA** (smaller, faster) |
| Hostnames | `hulkstein.com, *.hulkstein.com` |
| Certificate validity | **15 years** |

Click *Create*. Cloudflare shows two text boxes:

- **Origin Certificate** → save to `cert.pem`
- **Private key** → save to `key.pem`

**This is the only time the private key is shown.** If you lose it,
you have to revoke the cert and generate a new one. Save both files to
a password manager / secure store before continuing.

## Step 3 — Install the cert on the Hetzner VPS

From your laptop:

```bash
# Copy the two files to a staging dir on the VPS
scp cert.pem key.pem root@178.104.131.141:/tmp/
```

Then on the VPS (`ssh root@178.104.131.141`):

```bash
sudo mkdir -p /etc/cloudflare/origin
sudo install -m 0644 -o root -g root /tmp/cert.pem /etc/cloudflare/origin/cert.pem
sudo install -m 0600 -o root -g root /tmp/key.pem  /etc/cloudflare/origin/key.pem
sudo shred -u /tmp/cert.pem /tmp/key.pem    # don't leave the cert in /tmp
```

Verify:

```bash
sudo ls -l /etc/cloudflare/origin/
# -rw-r--r-- root root cert.pem
# -rw------- root root key.pem

# Sanity-check: the cert should report Cloudflare as issuer and list
# hulkstein.com + *.hulkstein.com as subject alt names.
sudo openssl x509 -in /etc/cloudflare/origin/cert.pem -noout -text \
  | grep -E "Issuer:|Subject Alternative Name|Not After"
```

## Step 4 — Deploy the TLS-aware nginx config

The production compose override (`docker-compose.prod.yml`):
- Adds `'443:443'` to the nginx `ports`.
- Mounts `/etc/cloudflare/origin` read-only inside the container.
- Volume-overlays `tls-listen.prod.conf` over the dev stub at
  `/etc/nginx/snippets/tls-listen.conf`, which activates the
  `listen 443 ssl http2;` line that every server block already
  includes.

On the VPS:

```bash
cd /opt/apphub
git pull                             # pulls the TLS-aware compose + snippets

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build nginx

# Reseed nginx blocks so they pick up the new `include tls-listen.conf`
# (already-rendered blocks in Redis were written before the change).
docker compose exec redis redis-cli DEL nginx:configs
docker compose restart platform-core nginx
```

Sanity-check that nginx is actually listening on `:443` inside the
container:

```bash
docker compose exec nginx sh -c "apk add --no-cache curl >/dev/null 2>&1; \
  curl -sk https://localhost/ -o /dev/null -w '%{http_code}\n'"
# → 200 (or 4xx, but not connection-refused/timeout)
```

If you see `nginx: [emerg] BIO_new_file("/etc/cloudflare/origin/cert.pem")
failed` in the logs, the volume mount didn't pick up the cert — verify
step 3.

## Step 5 — Open port 443 on the Hetzner firewall

Hetzner Cloud Firewall (UI) or `ufw` on the VPS:

```bash
# Inbound 443/tcp from Cloudflare ranges only (and 80/tcp too, for any
# fallback or ACME challenges if you ever issue a non-CF cert).
sudo ufw allow ssh
for cidr in $(curl -s https://www.cloudflare.com/ips-v4/); do
  sudo ufw allow proto tcp from "$cidr" to any port 443
  sudo ufw allow proto tcp from "$cidr" to any port 80
done
sudo ufw default deny incoming
sudo ufw enable
```

(Skip the `default deny` line if you're not 100% sure yet — you can
verify the rules first with `sudo ufw status numbered` and enable when
ready.)

## Step 6 — Flip Cloudflare to Full (Strict)

`SSL/TLS → Overview → Configure`:

- **Encryption mode**: `Full (Strict)`

Then `SSL/TLS → Edge Certificates`:

- ✅ **Always Use HTTPS** → ON
- ✅ **Automatic HTTPS Rewrites** → ON
- **Minimum TLS Version** → `TLS 1.2`
- HSTS — leave off until step 7 is healthy for ≥ 1 week (HSTS is hard
  to roll back).

## Step 7 — Verify

```bash
# DNS goes through Cloudflare (different IPs than 178.104.131.141)
dig hulkstein.com +short
dig aikikan.hulkstein.com +short

# Edge TLS (cert issuer should be "Cloudflare Inc ECC CA-3" or similar)
curl -v https://hulkstein.com/ 2>&1 | grep -E "subject:|issuer:|HTTP/"

# Origin TLS — should NOT throw 526 (cert invalid) or 525 (handshake)
curl -sf https://aikikan.hulkstein.com/api/auth/health

# Direct origin probe (bypassing CF) using --resolve. Should succeed
# because we control the cert, and the cert covers the host name.
curl --resolve aikikan.hulkstein.com:443:178.104.131.141 \
     -v https://aikikan.hulkstein.com/api/auth/health 2>&1 \
     | grep -E "issuer:|HTTP/"
# Issuer should be "CN=Cloudflare Origin Certificate Authority,…"
```

Common failure codes from Cloudflare:

| Code | Meaning |
|------|---------|
| `522` | Origin TCP timeout — firewall too strict, or nginx not listening on 443 |
| `525` | TLS handshake failed — protocol mismatch, or cert/key file unreadable inside container |
| `526` | Origin cert validation failed — cert isn't a CF Origin Cert, or hostname mismatch |
| `502` | Origin reachable + cert OK but upstream app behind nginx is down |

## Step 8 — Optional hardening

After step 7 is stable for ≥ 1 week:

- **HSTS**: `SSL/TLS → Edge Certificates → HTTP Strict Transport Security`
  → enable with `max-age=15552000` (180 d), `includeSubDomains`, no
  preload yet. Bump to 1 year + preload after another month.
- **Authenticated Origin Pulls**: in CF, `SSL/TLS → Origin Server →
  Authenticated Origin Pulls`. Forces every CF→origin request to
  present a CF client cert; origin nginx verifies it with
  `ssl_client_certificate` + `ssl_verify_client on`. Makes spoofed
  direct hits impossible even if the firewall leaks.
- **Refresh CF IP ranges**: `infra/nginx/snippets/cloudflare-real-ip.conf`
  hard-codes the CIDR list. CF updates it occasionally; re-pull from
  https://www.cloudflare.com/ips-v4/ once or twice a year.

## Email (MX records)

This zone currently carries **no MX records** — confirmed by the user:
no email service runs on `hulkstein.com`. Leave it that way. If email
ever lands here, configure SPF / DKIM / DMARC at the same time to avoid
deliverability surprises.

## Recovery / rollback

- **DNS regression**: flip the proxy back to grey cloud (DNS-only) in
  Cloudflare; traffic goes straight to Hetzner, useful when debugging.
  TLS will then need a Let's Encrypt cert if you want it on origin,
  since the CF Origin Cert is only trusted by Cloudflare.
- **Cert / TLS regression**: drop Cloudflare back to plain `Full`
  (non-strict) while you reissue an origin cert.
- **Reseed nginx blocks**: `docker compose exec redis redis-cli DEL
  nginx:configs && docker compose restart platform-core nginx`.
- **Disable origin TLS without redeploy**: blank
  `/etc/cloudflare/origin/cert.pem` won't help (nginx fails to load).
  Instead remove the prod TLS overlay by editing
  `docker-compose.prod.yml` to drop the `tls-listen.prod.conf` mount
  and the `443:443` port, then `docker compose up -d nginx`.
