# RUNBOOK

## Prerequisites

- Node.js >= 18.0.0 (check with `node --version`)
- Docker and Docker Compose (check with `docker --version` and `docker-compose --version`; if `docker-compose` is not found, use Compose v2: `docker compose version` and run commands as `docker compose ...`)
- jq (optional, for pretty-printing JSON in the optional verify script; if missing, raw curl output is fine)
- npm (comes with Node.js)
- Git (for cloning)

## Initial Setup

- Clone repository: `git clone https://github.com/BogdanMod/lego_bot.git && cd lego_bot`
- Install dependencies: `npm install` (installs all workspace packages)
- Copy `.env.example` to `.env`: `cp .env.example .env`
  - Option (Windows PowerShell): `copy .env.example .env` or `Copy-Item .env.example .env`
- Generate encryption key:
  ```bash
  # Option 1: Using openssl
  openssl rand -base64 32
  
  # Option 2: Using Node.js
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- Edit `.env` and set:
  - `TELEGRAM_BOT_TOKEN` (get from @BotFather)
  - `ENCRYPTION_KEY` (paste generated key)
  - Verify `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/dialogue_constructor`
  - Verify `REDIS_URL=redis://localhost:6379`

## Starting Services

Step 1: Start databases
```bash
docker-compose up -d
```
> **Option (Compose v2):** If `docker-compose` is not available, use `docker compose up -d`.
Wait 10-15 seconds for health checks to pass. Verify with:
```bash
docker-compose ps
# Both postgres and redis should show "healthy" status
```
> **Option (Compose v2):** `docker compose ps`

Step 2: Verify database connectivity
```bash
cd packages/core
npm run test-db
```
Expected output: PostgreSQL and Redis connection successful messages.

Step 3: Start core service (Terminal 1)
```bash
cd packages/core
npm run dev
```
Wait for "✅ PostgreSQL initialized" and "✅ Redis initialized" messages. Verify health:
```bash
curl http://localhost:3000/health
# Example output: {"status":"ok","databases":{"postgres":"ready","redis":"ready"}} (exact fields may vary; expect `status: ok|degraded` and a `databases` block)
```

Step 4: Start router service (Terminal 2)
```bash
cd packages/router
npm run dev
```
Wait for "✅ PostgreSQL pool initialized" and "✅ Redis initialized" messages. Verify health:
```bash
curl http://localhost:3001/health
# Example output: {"status":"ok","service":"router","databases":{"postgres":"ready","redis":"ready"}} (exact fields may vary; expect `status: ok|degraded` and a `databases` block)
```

Step 5: Start mini-app (Terminal 3)
```bash
cd packages/mini-app
npm run dev
```
Open browser to `http://localhost:5174`.
> **Option:** If port 5174 is busy, Vite will offer a different port; use the URL printed in the terminal output. Check browser console for "🏠 Local dev detected, using: http://localhost:3000".

## Verification Checklist

- [ ] `npm install` at repo root succeeds without errors
- [ ] `docker-compose up -d` brings up PostgreSQL and Redis with "healthy" status
- [ ] `docker-compose ps` shows both containers running
- [ ] `cd packages/core && npm run test-db` passes with ✅ messages
- [ ] `cd packages/core && npm run dev` starts without DB errors
- [ ] `curl http://localhost:3000/health` returns JSON with `status: "ok"` (or `"degraded"` if Redis is down)
- [ ] `cd packages/router && npm run dev` starts without DB/Redis errors
- [ ] `curl http://localhost:3001/health` returns JSON with `status: "ok"` (or `"degraded"` if Redis is down)
- [ ] Mini-app loads at `http://localhost:5174` without JS errors
- [ ] Mini-app console shows "🏠 Local dev detected"
- [ ] Mini-app can fetch bot list (test with user_id in Telegram WebApp or mock)

## Testing Mini-App API Connectivity

Local testing (without Telegram):
```bash
# Test bot list endpoint
curl "http://localhost:3000/api/bots?user_id=123"

# Test get schema endpoint
curl "http://localhost:3000/api/bot/YOUR_BOT_ID/schema?user_id=123"

# Test update schema endpoint
curl -X POST "http://localhost:3000/api/bot/YOUR_BOT_ID/schema?user_id=123" \
  -H "Content-Type: application/json" \
  -d '{"version":1,"initialState":"start","states":{"start":{"message":"Hello"}}}'
```

Testing in Telegram:
1. Open bot in Telegram
2. Send `/start` command
3. Click "Open Mini App" button
4. Mini-app should load and fetch bot list automatically
5. Check browser console (Telegram Desktop) or use remote debugging (mobile)

## Known Gotchas

1. **Port Conflicts**
   - Core uses port 3000, router uses 3001, mini-app uses 5174
   - Option: If 5174 is already in use, Vite will select another port (check the terminal output).
   - PostgreSQL uses 5433 (not default 5432 to avoid conflicts)
   - Redis uses 6379 (default)
   - If ports are in use, stop conflicting services or change ports in `.env`

2. **Environment Variables**
   - All services read from root `.env` file (not package-specific .env files)
   - `ENCRYPTION_KEY` must be at least 32 characters
   - Same `ENCRYPTION_KEY` must be used in both core and router
   - `TELEGRAM_BOT_TOKEN` format: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

3. **Database Health Checks**
   - Docker containers need 10-15 seconds to become "healthy"
   - Don't start core/router until `docker-compose ps` shows "healthy"
   - If services start before DB is ready, they will retry up to 5 times with exponential backoff

4. **Redis Graceful Degradation**
   - If Redis fails, core and router will log warnings but continue running
   - Sessions will use memory instead of Redis
   - Status will show "degraded" instead of "ok"

5. **CORS Issues**
   - Core allows localhost origins by default
   - If mini-app shows CORS errors, check core logs for "🔍 CORS check" messages
   - Verify mini-app is running on port 5174 (configured in `file:packages/mini-app/vite.config.ts`)

6. **Telegram WebApp Context**
   - Mini-app requires Telegram WebApp context to get user_id
   - For local testing without Telegram, mock `window.Telegram.WebApp` or use curl commands
   - See `file:packages/mini-app/src/utils/api.ts` for user_id extraction logic

7. **Database Initialization Race Condition**
   - Core uses `ensureDatabasesInitialized` middleware to prevent race conditions
   - First API request may take 2-3 seconds while databases initialize
   - Subsequent requests will be fast

## Troubleshooting

Problem: `npm install` fails
- Solution: Check Node.js version (`node --version` should be >= 18.0.0)
- Solution: Clear npm cache: `npm cache clean --force`
- Solution: Delete `node_modules` and `package-lock.json`, then retry

Problem: Docker containers won't start
- Solution: Check Docker is running: `docker ps`
- Solution: Check port availability: `lsof -i :5433` (macOS/Linux) or `netstat -ano | findstr :5433` (Windows)
- Solution: Stop existing containers: `docker-compose down -v`
  - Option (Compose v2): `docker compose down -v`

Problem: `test-db` script fails with "connection refused"
- Solution: Wait 15 seconds after `docker-compose up -d`
- Solution: Check container health: `docker-compose ps`
- Solution: Check container logs: `docker-compose logs postgres` or `docker-compose logs redis`

Problem: Core starts but shows "PostgreSQL initialization failed"
- Solution: Verify `DATABASE_URL` in `.env` matches docker-compose settings
- Solution: Check PostgreSQL logs: `docker-compose logs postgres`
- Solution: Restart PostgreSQL: `docker-compose restart postgres`

Problem: Mini-app shows CORS errors
- Solution: Check core is running on port 3000
- Solution: Check mini-app console for API URL (should be `http://localhost:3000`)
- Solution: Check core logs for CORS messages
- Solution: Verify `VITE_API_URL_LOCAL=http://localhost:3000` in `file:packages/mini-app/.env.example`

Problem: Mini-app can't fetch bot list
- Solution: Check core health: `curl http://localhost:3000/health`
- Solution: Test API directly: `curl "http://localhost:3000/api/bots?user_id=123"`
- Solution: Check browser console for detailed error messages
- Solution: Verify mini-app is detecting localhost correctly (look for "🏠 Local dev detected" message)

Problem: "User ID not found" error in mini-app
- Solution: Mini-app requires Telegram WebApp context
- Solution: For local testing, use curl commands instead
- Solution: Or mock `window.Telegram.WebApp.initDataUnsafe.user.id` in browser console

## Quick Reference Commands

> **Option (Compose v2):** Replace `docker-compose ...` with `docker compose ...` if `docker-compose` is not available.

```bash
# Start everything
docker-compose up -d                    # Start databases
cd packages/core && npm run dev         # Terminal 1: Core
cd packages/router && npm run dev       # Terminal 2: Router
cd packages/mini-app && npm run dev     # Terminal 3: Mini-app

# Health checks
curl http://localhost:3000/health       # Core health
curl http://localhost:3001/health       # Router health
docker-compose ps                       # Database health

# Stop everything
docker-compose down                     # Stop databases (keeps data)
docker-compose down -v                  # Stop databases (removes data)
Ctrl+C in each terminal                 # Stop services

# Logs
docker-compose logs postgres            # PostgreSQL logs
docker-compose logs redis               # Redis logs
docker-compose logs -f                  # Follow all logs

# Database access
docker exec -it dialogue-constructor-postgres psql -U postgres -d dialogue_constructor
docker exec -it dialogue-constructor-redis redis-cli
```

## One-command dev (optional)

This repo includes a root `npm run dev` script (Turbo) that starts core/router/mini-app together:

```bash
npm run dev
```

Notes:
- Uses Turbo (`turbo run dev`) to run workspace `dev` scripts in parallel.
- Starts the `dev` scripts for `packages/core`, `packages/router`, and `packages/mini-app`.
- Logs will appear interleaved in the same terminal output.
- Turbo prefixes output with the package/task name (for example: `core:dev`, `router:dev`, `mini-app:dev`) to help identify which service produced a log line.

## Verification Workflow Diagram

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Docker as Docker Compose
    participant PG as PostgreSQL
    participant Redis as Redis
    participant Core as Core Service
    participant Router as Router Service
    participant MiniApp as Mini-App

    Dev->>Docker: docker-compose up -d
    Docker->>PG: Start container
    Docker->>Redis: Start container
    PG-->>Docker: Health check (10-15s)
    Redis-->>Docker: Health check (10-15s)
    
    Dev->>Core: npm run test-db
    Core->>PG: Test connection
    Core->>Redis: Test connection
    PG-->>Core: ✅ Connected
    Redis-->>Core: ✅ Connected
    
    Dev->>Core: npm run dev
    Core->>PG: Initialize with retry
    Core->>Redis: Initialize with retry
    PG-->>Core: ✅ Ready
    Redis-->>Core: ✅ Ready
    Core-->>Dev: Listening on :3000
    
    Dev->>Router: npm run dev
    Router->>PG: Initialize with retry
    Router->>Redis: Initialize with retry
    PG-->>Router: ✅ Ready
    Redis-->>Router: ✅ Ready
    Router-->>Dev: Listening on :3001
    
    Dev->>MiniApp: npm run dev
    MiniApp-->>Dev: Vite server on :5174
    
    Dev->>MiniApp: Open localhost:5174
    MiniApp->>Core: GET /api/bots?user_id=X
    Core-->>MiniApp: 200 OK [bot list]
```

## Stage 1 Stabilization - Acceptance Criteria

- [ ] `npm install` at repo root succeeds
- [ ] `docker-compose up -d` brings up Postgres+Redis
- [ ] `cd packages/core && npm run test-db` passes
- [ ] `cd packages/core && npm run dev` starts without DB errors
- [ ] `cd packages/router && npm run dev` starts without DB/Redis errors
- [ ] Mini-app runs locally and can hit core API successfully (no CORS errors)
- [ ] When pointing mini-app to deployed core API, requests succeed (CORS + base URL ok)
- [ ] Documentation updated so new dev can launch in <10 minutes

## Health Check Commands
```bash
# All should return status "ok" or "degraded" (if Redis is down)
curl http://localhost:3000/health
curl http://localhost:3001/health
docker-compose ps  # Both should show "healthy"
```
