# Cloudflare DNS — `hulkstein.com` → Hetzner

How to point `hulkstein.com` (purchased at Cloudflare Registrar) at the
Hetzner VPS that hosts apphub in production. Mode: **proxied** (orange
cloud) — TLS terminates at Cloudflare, the origin only speaks HTTP on
port 80.

## Target topology

```
Browser ── HTTPS ──▶ Cloudflare edge ── HTTP ──▶ Hetzner :80 (nginx)
                       │
                       └── *.hulkstein.com + hulkstein.com (Universal SSL)
```

- Cloudflare → origin uses HTTP on `:80` (SSL mode = **Full**). It can be
  hardened to **Full (strict)** with a Cloudflare Origin Certificate
  later — see "Hardening" below.
- Origin nginx listens on `:80` and matches `server_name` against
  `<sub>.hulkstein.com` (production) and `<sub>.apphub.local` (dev,
  unaffected).

## Pre-requisites

- Hetzner VPS reachable on the public IPv4. The current production IP is
  `178.104.131.141`; substitute yours if it changes.
- `hulkstein.com` registered at Cloudflare Registrar (or DNS delegated
  to Cloudflare nameservers). Confirm under
  `Overview → "Cloudflare is using your zone"`.
- Deploy `main` to the VPS so the nginx image carries the new
  `server_name` (`*.hulkstein.com`) and the `cloudflare-real-ip.conf`
  snippet.

## Step 1 — DNS records (Cloudflare UI)

`hulkstein.com → DNS → Records → Add record`

| Type | Name | Content            | Proxy        | TTL  |
|------|------|--------------------|--------------|------|
| A    | `@`  | `178.104.131.141`  | 🟠 Proxied   | Auto |
| A    | `*`  | `178.104.131.141`  | 🟠 Proxied   | Auto |

The wildcard covers every app subdomain (`aikikan.hulkstein.com`,
`splitpay.hulkstein.com`, `voragine-console.hulkstein.com`, …) and every
tenant subdomain rendered by `platform/tenant-config` at runtime.

Verification:

```bash
dig hulkstein.com           +short   # → CF IPs (not 178.104.131.141)
dig aikikan.hulkstein.com   +short   # → same CF IPs
```

If `dig` still returns `178.104.131.141`, the proxy is off (grey cloud)
— flip it to orange.

## Step 2 — SSL/TLS settings

`SSL/TLS → Overview`:

- **Encryption mode**: `Full` (TLS browser↔CF, HTTP CF↔origin)
  - Do NOT use `Flexible` (CF↔origin in clear — leaks)
  - Upgrade to `Full (strict)` after installing the origin cert
    (Hardening section below)

`SSL/TLS → Edge Certificates`:

- ✅ **Always Use HTTPS** — `ON`
- ✅ **Automatic HTTPS Rewrites** — `ON`
- **Minimum TLS Version** — `TLS 1.2`
- HSTS — leave off for now; turn on after verifying everything is healthy
  for ≥ 1 week (HSTS is hard to roll back).

`SSL/TLS → Edge Certificates → Universal SSL` should already be
`Active`. Universal SSL covers `hulkstein.com` and `*.hulkstein.com`. It
does **not** cover nested wildcards (e.g. `foo.bar.hulkstein.com`); no
app currently needs that.

## Step 3 — Deploy the origin

The production deploy already applies the changes from
`chore(infra): switch public domain to hulkstein.com`:

- `infra/nginx/seed/*.conf` matches `<sub>.hulkstein.com`
- `infra/nginx/snippets/cloudflare-real-ip.conf` is included in the
  http block so logs / `limit_req` see the real client IP
- `docker-compose.prod.yml` sets `PLATFORM_PUBLIC_DOMAIN=hulkstein.com`
  on `platform-core`, so dynamically rendered tenant blocks also match
  `<sub>.hulkstein.com`

Force-reseed the per-app blocks in Redis (since the seeded ones already
in `nginx:configs` may still carry the old hostnames):

```bash
ssh root@178.104.131.141
cd /opt/apphub
docker compose exec redis redis-cli DEL nginx:configs
docker compose restart nginx       # sidecar re-seeds on init
```

For tenants that were created via `platform/tenant-config`, the easiest
re-render is to bounce `platform-core` — its boot hook republishes every
tenant block to Redis.

## Step 4 — Verify

```bash
# DNS goes through Cloudflare
dig hulkstein.com +short
dig aikikan.hulkstein.com +short

# TLS handshake at the edge
curl -v https://hulkstein.com/                       2>&1 | grep -E "subject:|issuer:"
curl -v https://aikikan.hulkstein.com/api/auth/health 2>&1 | tail -20

# Health endpoint should return 200 — anything else means the origin
# isn't matching the new server_name yet.
curl -sf https://aikikan.hulkstein.com/api/auth/health
```

Common failure codes from Cloudflare:

| Code | Meaning |
|------|---------|
| `502` | Origin reachable but app behind nginx is down |
| `522` | Origin TCP timeout — Hetzner firewall blocking CF? |
| `525` | TLS handshake failed (only matters once on Full strict) |
| `526` | Origin cert validation failed (Full strict, bad/expired cert) |

## Step 5 — Restrict origin to Cloudflare (recommended)

Once everything works through Cloudflare, lock the origin so the public
IP can no longer be hit directly. Hetzner Cloud Firewall (UI) or `ufw`
on the VPS:

```bash
# Drop port 80 for everyone except Cloudflare IP ranges.
# (Copy the up-to-date list from https://www.cloudflare.com/ips-v4/
# and re-run periodically; it changes a few times a year.)
ufw default deny incoming
ufw allow ssh
for cidr in $(curl -s https://www.cloudflare.com/ips-v4/); do
  ufw allow proto tcp from "$cidr" to any port 80
done
ufw enable
```

This is what makes Cloudflare a real shield instead of just a CDN.

## Hardening — Full (strict) with Origin Certificate

When you want CF↔origin to be authenticated TLS:

1. `SSL/TLS → Origin Server → Create Certificate`
   - Hostnames: `hulkstein.com, *.hulkstein.com`
   - Key type: `ECDSA` (smaller, faster)
   - Validity: 15 years
   - Download `cert.pem` and `key.pem`

2. On the Hetzner VPS:
   ```bash
   sudo mkdir -p /etc/cloudflare/origin
   sudo install -m 0644 cert.pem /etc/cloudflare/origin/cert.pem
   sudo install -m 0600 key.pem  /etc/cloudflare/origin/key.pem
   ```

3. Mount it into the nginx container (compose override) and add a
   `listen 443 ssl http2;` block — TODO when we cut over.

4. Flip Cloudflare to `Full (strict)`. CF stops accepting any cert other
   than the Origin Cert (or a legitimate cert signed by a public CA, but
   the Origin Cert is the simplest path).

## Email (MX records)

This zone currently carries **no MX records** — confirmed by the user:
no email service runs on `hulkstein.com`. Leave it that way. If email
ever lands here, configure SPF / DKIM / DMARC at the same time to avoid
deliverability surprises.

## Recovery / rollback

- **DNS regression**: flip the proxy back to grey cloud (DNS-only) in
  Cloudflare; traffic goes straight to Hetzner, useful when debugging.
- **Cert regression on strict mode**: drop Cloudflare back to plain
  `Full` while you reissue an origin cert.
- **Reseed nginx blocks**: `docker compose exec redis redis-cli DEL
  nginx:configs && docker compose restart nginx`.
