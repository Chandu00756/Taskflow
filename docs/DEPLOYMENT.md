# Going live on taskflow.portalvii.com (free hosting)

This guide puts the whole TaskFlow Service Desk online at
**https://taskflow.portalvii.com** for **$0 a month**. You only keep paying
for the `portalvii.com` domain itself.

> Subdomains always sit under a domain you own: with `portalvii.com` you can
> use `taskflow.portalvii.com` (or `help.portalvii.com`, `desk.portalvii.com`…).
> `portalvii.taskflow.com` would require owning `taskflow.com`.

---

## 1. What runs where

| Piece | Free choice | Why |
|---|---|---|
| **Server** | Oracle Cloud **Always Free** Ampere A1 VM (up to 4 CPUs, 24 GB RAM, 200 GB disk) | Runs all six backend services, the database and the website 24/7 without sleeping |
| **Database** | **PostgreSQL 16** on the same server, with automatic nightly backups | The app needs PostgreSQL (JSONB, full-text search); no size caps, no pausing |
| **Frontend** | Same server (Next.js container) | One address, no cross-site setup |
| **HTTPS** | **Caddy** with Let's Encrypt | Certificates are issued and renewed automatically |
| **DNS** | Wherever `portalvii.com` is managed (or Cloudflare's free DNS) | One `A` record |
| **Email** *(optional)* | Brevo (300/day) or Resend (100/day) free SMTP | Invitations, notifications, password resets |
| **Uptime alerts** *(optional)* | UptimeRobot or Better Stack free | Emails you if the site goes down |

```
 Browser ──HTTPS──> Caddy (80/443) ──/api──> api-gateway ──> user / task / notification / org / itsm services
                                    └──────> web (Next.js)                     │
                                                                                └──> PostgreSQL, Redis
```

**Why not Render, Railway, Fly.io or Koyeb free tiers?** They either put
services to sleep after a few minutes of inactivity, allow only one service,
or give a one-off credit. TaskFlow is eight long-running containers, so a free
VM is the reliable option.

**Other free databases** (only if you later move the database off the server):
Neon (0.5 GB, pauses when idle) and Supabase (500 MB, pauses after a week of
inactivity) both work. Point `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` at
them and set `DB_SSLMODE=require`.

---

## 2. Create the free server (Oracle Cloud)

1. Sign up at **cloud.oracle.com** ("Start for free"). A card is needed for
   identity verification; Always Free resources are not charged. Pick a
   **home region** close to your users — it cannot be changed later.
2. **Compute → Instances → Create instance**
   - **Image:** Canonical Ubuntu 24.04
   - **Shape:** *Ampere* → `VM.Standard.A1.Flex`, **4 OCPUs, 24 GB memory**
     (the Always Free allowance)
   - **Networking:** keep "Assign a public IPv4 address" on
   - **SSH keys:** upload your public key (`~/.ssh/id_ed25519.pub`) or let
     Oracle generate one and download it
   - **Boot volume:** set **100 GB** (free up to 200 GB in total)
   - If you see *"Out of capacity"*, try the other availability domains. If
     every domain refuses even 1 OCPU (common for Free Trial accounts in busy
     regions such as Ashburn), upgrade the account to **Pay As You Go** —
     Always Free resources stay free; add a $1 budget alert — and try again.
     Don't settle for the 1 GB `VM.Standard.E2.1.Micro`: it is too small to
     build and run TaskFlow.
3. **Open the web ports in Oracle's network firewall:** on the instance page
   click the **Subnet** → **Security List** → **Add Ingress Rules**:

   | Source CIDR | Protocol | Destination port |
   |---|---|---|
   | `0.0.0.0/0` | TCP | `80` |
   | `0.0.0.0/0` | TCP | `443` |
   | `0.0.0.0/0` | UDP | `443` |

4. Note the instance's **Public IP address**.

> Oracle may reclaim Always Free instances that stay almost idle for a week.
> Upgrading the account to *Pay As You Go* keeps Always Free resources free and
> avoids this; add a $1 budget alert under **Billing → Budgets** to be safe.

---

## 3. Point taskflow.portalvii.com at the server

At the company where `portalvii.com`'s DNS is managed (your registrar, or
Cloudflare if you moved DNS there), add:

| Type | Name / Host | Value | TTL |
|---|---|---|---|
| `A` | `taskflow` | *your server's public IP* | 300 (5 min) |

On Cloudflare, leave the cloud **grey (DNS only)** until the site works; you
can turn the proxy on afterwards with SSL mode **Full (strict)**.

### portalvii.com specifics (Zoho DNS + Vercel website)

`portalvii.com` is registered through Zoho and its DNS zone lives at Zoho
(`ns1/ns2/ns3.systemdns.com`): the website points to Vercel (`@` → `76.76.21.21`,
`www` → `cname.vercel-dns.com`) and mail goes to Zoho Mail. The domain also
lists Vercel's nameservers (`ns1/ns2.vercel-dns.com`), whose zone has no mail
records and a catch-all to Vercel, so lookups randomly hit either zone.

1. **Use one DNS provider (Zoho).** In Zoho Domains → `portalvii.com` →
   *Name Servers*, remove `ns1.vercel-dns.com` and `ns2.vercel-dns.com` and keep
   the three `systemdns.com` servers. The website keeps working (Zoho's records
   already point to Vercel); keep the domain in your Vercel project. The change
   takes up to 48 hours to spread.
2. **Add the TaskFlow record in Zoho DNS:** type `A`, host `taskflow`, value =
   the Oracle server's public IP, lowest TTL.
3. **Until step 1 has spread,** add the same `A` record in Vercel
   (Domains → `portalvii.com` → DNS Records) so both zones agree.
4. **Merge the SPF records** in Zoho DNS into one TXT record:
   `v=spf1 include:zohomail.com include:mailgun.org ~all`. Two separate
   `v=spf1` records make SPF fail and push your mail towards spam.

Check it from your computer (it can take a few minutes):

```bash
nslookup taskflow.portalvii.com
```

---

## 4. Install TaskFlow on the server

```bash
ssh ubuntu@YOUR_SERVER_IP
```

Get the code onto the server (for a private GitHub repository, create a
read-only *deploy key* or a fine-grained token first):

```bash
git clone https://github.com/YOUR_ACCOUNT/Taskflow.git
```

```bash
cd Taskflow && sudo bash deployments/production/setup-server.sh
```

The script:

- installs Docker from Ubuntu's own packages and turns on automatic security updates,
- opens ports 80/443 in the server firewall (Oracle images block them by default),
- asks for the domain (`taskflow.portalvii.com`), your email and the super-admin email,
- writes `deployments/production/.env` with random database and token secrets (`chmod 600`),
- builds and starts everything (first build: about 5–10 minutes).

Then open **https://taskflow.portalvii.com**. The first visit may take a
minute while the certificate is issued.

### First sign-in

1. Sign in as the **super admin** — the email you entered and the password in
   `deployments/production/.env` (`SUPER_ADMIN_PASSWORD`). This account runs
   the platform console (organizations, suspensions).
2. Click **Create an organization** on the sign-in page to create your
   company's service desk and its first admin. That admin then adds agents,
   requesters, org units, teams and so on from **Admin**.
3. Change the super-admin password under **Profile → Security**, then remove
   `SUPER_ADMIN_PASSWORD` from `.env` if you like (it is only used to create
   the account the first time).

The app works in any modern browser on phones, tablets and computers.

---

## 5. Day-to-day operations

All commands run in `~/Taskflow/deployments/production` on the server.

| Task | Command |
|---|---|
| See status | `docker compose ps` |
| Follow logs | `docker compose logs -f --tail 100 caddy api-gateway itsm-service` |
| Restart one service | `docker compose restart itsm-service` |
| Deploy new code | pull the new code, then `bash update.sh` (takes a backup first) |
| List backups | `ls -lh backups/` |
| Restore a backup | `bash restore.sh backups/taskflow-YYYYMMDD-HHMMSS.sql.gz` |
| Stop everything | `docker compose down` (data is kept) |

**Backups.** A nightly dump lands in `deployments/production/backups/` and is
kept for 14 days (`BACKUP_KEEP_DAYS`). Copy them off the server regularly, for
example to your computer:

```bash
scp ubuntu@YOUR_SERVER_IP:Taskflow/deployments/production/backups/*.sql.gz ./taskflow-backups/
```

**Email.** TaskFlow emails ticket notifications, welcome messages with
temporary passwords, sign-up verification links and password reset links.
Fill in the `SMTP_*` values in `.env` (see the examples there), then:

```bash
docker compose up -d user-service itsm-service
```

Open the **platform console → Email** tab and use **Send test email**. It
shows the mail server's exact answer if something is wrong (wrong password,
sender not allowed…). Once email works, people who sign up themselves must
confirm their address before signing in (`EMAIL_VERIFICATION=auto`); accounts
created by an admin are not affected.

*Zoho Mail (a mailbox on your domain):* turn on two-factor sign-in, create an
app password at **accounts.zoho.com → Security → App passwords**, and use
`SMTP_HOST=smtp.zoho.com` (paid plans: `smtppro.zoho.com`), `SMTP_PORT=465`,
`SMTP_USER=` the mailbox and `SMTP_PASS=` the app password. `SMTP_FROM` must be
that mailbox or one of its aliases, e.g. `TaskFlow <support@portalvii.com>`.
If Zoho answers **"550 5.7.1 Sender is not allowed to relay emails"**, the
address in `SMTP_FROM` is not the mailbox in `SMTP_USER` or one of its aliases.
Either set `SMTP_FROM` to that mailbox, or add the address as an alias of it
(Zoho Mail admin console → Users → the mailbox → Email alias). Until then
TaskFlow sends from `SMTP_USER` (replies still go to `SMTP_FROM`) and the
Email tab says so. After fixing the settings, use **Retry failed emails**.

If the test email reports that sign-in failed even with an app password, your
Zoho plan does not allow sending from apps: use **Zoho ZeptoMail**
(`smtp.zeptomail.com`, port 587, user `emailapikey`) or **Brevo**
(`smtp-relay.brevo.com`, port 587) instead. Both show the SPF/DKIM records to
add in Zoho DNS so your mail is not marked as spam.

**Uptime alerts.** Add an HTTP monitor for
`https://taskflow.portalvii.com/health` in UptimeRobot or Better Stack.

---

## 6. Security checklist

- [ ] `.env` is only readable by you (`ls -l deployments/production/.env` shows `-rw-------`)
- [ ] SSH uses keys only (Oracle images disable password login by default)
- [ ] Super-admin password changed after the first sign-in
- [ ] Only ports 22, 80 and 443 are open in the Oracle security list
- [ ] Backups are copied off the server
- [ ] Optional: limit SSH (port 22) in the security list to your own IP

The database, Redis and the internal services are not published to the
internet; only Caddy listens on 80/443, and the gateway's `/metrics` endpoint
is not routed.

---

## 7. Moving off the free tier later

The same `deployments/production` stack runs on any Linux VM with Docker
(Hetzner, DigitalOcean, AWS Lightsail…). Copy `.env` and a backup, run
`setup-server.sh`, restore the backup, and switch the DNS `A` record. For
larger scale, the Kubernetes manifests in `deployments/k8s` and the CI/CD
workflow in `.github/workflows` are the next step.
