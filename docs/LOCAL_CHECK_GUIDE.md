# Check Findstuff without a Pi

You can test the app on your laptop or desktop before installing it on a Banana Pi or Raspberry Pi. This uses the same FastAPI backend and built PWA that the Pi service uses, but stores data in a local test folder.

## One command

From the repository:

```bash
./scripts/local-check.sh
```

Open the printed URL, normally:

```text
http://127.0.0.1:8000/
```

The app opens directly in local single-user mode. The test database is stored in `.local-data/`, not in the Pi deployment paths.

## What this checks

- Backend startup and SQLite migrations.
- The production React/Vite build in `frontend/dist`.
- Search, add item, locations, dashboard, barcode manual lookup, QR pages, exports, and management screens.
- Browser camera and microphone permissions when your browser allows them.

`localhost` counts as a secure browser context, so camera and microphone testing usually works from `http://127.0.0.1:8000/`. On a phone pointed at another machine's LAN IP, camera/microphone usually require HTTPS; the Pi guide recommends Tailscale HTTPS for that reason.

## Useful checks to run

```bash
curl http://127.0.0.1:8000/api/v1/health
.venv/bin/findstuff doctor
```

Frontend-only development is still available:

```bash
.venv/bin/uvicorn findstuff.app:app --app-dir backend --reload
cd frontend
npm run dev
```

Vite proxies `/api` to the backend in development mode.

## Reset local test data

Stop the server and remove only the local check data:

```bash
rm -rf .local-data
```

Do not run that command on the production checkout. The Docker installer stores
production data in the repository checkout’s ignored `data/` directory.
