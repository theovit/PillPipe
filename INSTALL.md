# PillPipe — Installation Guide

This guide covers setting up the **web interface** (self-hosted). The `app/` folder is the Android app and is not needed here.

---

## Instructions for Claude Code

When a user asks you to install, set up, or get PillPipe running, follow these steps in order. Do as much as possible automatically — only stop to ask the user when a step genuinely requires their input (marked **ASK USER**).

### Step 1 — Check prerequisites

Run these checks in parallel:

```bash
docker --version
docker compose version
git --version
node --version
```

- If `docker` is missing: tell the user to install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and re-run setup after it's installed. Stop here.
- If Docker is installed but not running (daemon not available): tell the user to start Docker Desktop, then wait and retry.
- If `node` is missing: it's only needed for VAPID key generation. Note this and skip VAPID setup in Step 4 — the app will still work without push notifications.
- `git` missing is only a problem if the repo hasn't been cloned yet.

### Step 2 — Create `.env` if it doesn't exist

Check whether `.env` already exists at the repo root:

```bash
test -f .env && echo "exists" || echo "missing"
```

If missing, copy from the example:

```bash
cp .env.example .env
```

### Step 3 — Set a secure database password

Read the current `DB_PASSWORD` value from `.env`. If it is still `changeme` (the default), generate a random password and replace it:

```bash
# Generate a 24-character alphanumeric password
node -e "console.log(require('crypto').randomBytes(18).toString('base64').replace(/[^a-zA-Z0-9]/g,'').slice(0,24))"
```

Use the Edit tool to replace the `changeme` value in `.env` with the generated password. Tell the user what it was set to.

### Step 4 — Generate and inject VAPID keys

Check whether `VAPID_PUBLIC_KEY` in `.env` still holds the placeholder value `generate_with_web-push_library`.

If it does and Node.js is available, generate real keys:

```bash
npx --yes web-push generate-vapid-keys --json 2>/dev/null || npx web-push generate-vapid-keys
```

Parse the public and private key from the output, then use the Edit tool to replace both placeholder values in `.env`. Leave `VAPID_EMAIL` as-is unless the user has provided an email — the default `mailto:admin@pillpipe.local` is valid enough for local use.

If Node.js is not available, skip this step and tell the user push notifications will be inactive until they run `npx web-push generate-vapid-keys` manually and fill in the keys.

### Step 5 — Check for port conflicts

```bash
# Check if port 5173 is already in use
lsof -ti :5173 2>/dev/null || netstat -ano 2>/dev/null | grep ":5173" | head -1 || echo "free"
```

If port 5173 is occupied, tell the user and suggest they change the host port in `docker-compose.yml` (e.g. `"5174:5173"`). **ASK USER** whether to change it or stop the conflicting process before continuing.

### Step 6 — Build and start containers

```bash
docker compose up --build -d
```

The `-d` flag runs containers in the background so the terminal isn't blocked.

Wait up to 30 seconds for the backend health check to pass:

```bash
# Poll until backend responds or timeout
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/ 2>/dev/null | grep -q "200" && echo "up" && break
  sleep 3
done
```

### Step 7 — Verify everything is running

```bash
docker compose ps
```

All three services (`frontend`, `backend`, `db`) should show status `Up` or `running`. If any service shows `Exit` or `Error`:

- Run `docker compose logs <service>` to get the error
- Common issues and fixes are in the Troubleshooting section below
- Fix the issue, then re-run `docker compose up --build -d`

### Step 8 — Done

Tell the user the app is ready at **http://localhost:5173** and summarise what was configured:
- Whether VAPID keys were generated or skipped
- The DB password that was set (so they can record it)
- Whether Google Drive backup is configured or not

**Note on Google Drive:** This requires manual setup in Google Cloud Console — see the Google Drive section below. Never attempt to automate this step.

---

## Manual reference

The sections below are the human-readable version of the steps above, for reference when doing things by hand or troubleshooting.

---

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Latest | Must be running before first use |
| [Git](https://git-scm.com/) | Any | For cloning the repo |
| [Node.js](https://nodejs.org/) | 18+ | Only needed to generate VAPID keys (one-time) |

> **Windows users:** Docker Desktop requires WSL 2. The installer will prompt you to enable it if needed.

---

### Clone the repository

```bash
git clone https://github.com/your-username/PillPipe.git
cd PillPipe
```

---

### The `.env` file

Copy the example and edit:

```bash
cp .env.example .env
```

#### Database credentials

```env
DB_USER=pillpipe
DB_PASSWORD=changeme        # Replace with a secure password
DB_NAME=pillpipe
```

Internal only — these are never exposed outside Docker.

#### VAPID keys (push notifications)

```bash
npx web-push generate-vapid-keys
```

Paste the output:

```env
VAPID_PUBLIC_KEY=<Public Key>
VAPID_PRIVATE_KEY=<Private Key>
VAPID_EMAIL=mailto:you@example.com
```

If you skip this, push notifications are inactive but everything else works.

#### Google Drive backup (optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable the **Google Drive API**
3. Create **OAuth 2.0 credentials** (Web application type)
4. Add authorized redirect URI: `http://localhost:5173/api/auth/google/callback`
   - For Tailscale remote access, also add `http://<tailscale-ip>:5173/api/auth/google/callback`
5. Fill in `.env`:

```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5173/api/auth/google/callback
```

---

### Start / stop

```bash
docker compose up --build    # First run or after dependency changes
docker compose up            # Normal start
docker compose up -d         # Start in background
docker compose down          # Stop (data is preserved)
docker compose down -v       # Stop and wipe all data
```

Containers and ports:

| Container | Role | Host port |
|-----------|------|-----------|
| `frontend` | Vite / React UI | `5173` |
| `backend` | Express REST API | internal only |
| `db` | PostgreSQL 13 | internal only |

---

### Remote access (Tailscale)

No auth layer is implemented — keep the app off the public internet. Use [Tailscale](https://tailscale.com/) for secure remote access:

1. Install Tailscale on the host and your devices
2. Access via Tailscale IP: `http://100.x.x.x:5173`

---

### Troubleshooting

**Frontend shows "Network Error" or blank data**
- The backend waits for Postgres to pass a health check before accepting connections. Wait 5–10 seconds and refresh.
- `docker compose logs backend` to inspect errors.

**Port 5173 already in use**
- Change the host port mapping in `docker-compose.yml` to e.g. `"5174:5173"`, then access via `:5174`.

**Database won't start**
- `docker compose logs db` — most common cause is a volume from a previous incompatible install. Run `docker compose down -v` to wipe it, then `docker compose up --build`.

**Code changes not reloading**
- Both services use polling-based watch for Windows/Docker compatibility. Changes apply within ~1 s. If they don't: `docker compose restart frontend` or `docker compose restart backend`.
