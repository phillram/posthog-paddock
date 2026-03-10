# PostHog Paddock 🦔

A Python (Flask) + vanilla JavaScript demo app for **debugging and understanding PostHog's local feature flag evaluation**. Also demonstrates events, error tracking, and user identification.

Built to be human-readable — every file is heavily commented so you can follow exactly how local evaluation works.

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Copy and fill in your .env
cp .env.example .env
# Edit .env with your keys (see below)

# 3. Run
python app.py

# 4. Access
Open [http://localhost:5111](http://localhost:5111).
```

## Environment Variables

| Variable | Description |
|---|---|
| `POSTHOG_PROJECT_API_KEY` | Your project API key (`phc_...`) — identifies your PostHog project |
| `POSTHOG_PERSONAL_API_KEY` | Your personal API key (`phx_...`) — required for local flag evaluation (lets the SDK download flag definitions) |
| `POSTHOG_HOST` | `https://us.i.posthog.com` (US) or `https://eu.i.posthog.com` (EU) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (vanilla JS)                               │
│                                                     │
│  posthog-js  ──▶  events, identify, errors ONLY     │
│                   (advanced_disable_feature_flags)   │
│                                                     │
│  fetch()  ──▶  GET /api/flags  ──▶  display results │
│           ──▶  POST /api/flags/override              │
│           ──▶  POST /api/flags/reload                │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────┐
│  Flask Backend (app.py)                             │
│                                                     │
│  FlagCache (flag_cache.py)                          │
│    ├─ PostHog Python SDK (local evaluation)         │
│    ├─ 30-second result cache                        │
│    └─ Manual override dict                          │
└─────────────────────────────────────────────────────┘
```

**Key point:** ALL feature flag evaluation happens in Python. The JavaScript frontend never evaluates flags — it only displays the results it gets from the backend.

### How Local Evaluation Works

1. On startup, the PostHog Python SDK fetches all flag definitions from PostHog (requires a Personal API Key).
2. The SDK polls for definition updates every 30 seconds automatically.
3. When we call `get_feature_flag(key, distinct_id, only_evaluate_locally=True)`, the SDK evaluates using local definitions — **no network call per evaluation**.
4. Our `FlagCache` adds a second cache layer: evaluated results are stored for 30 seconds before re-evaluating.

### How Overrides Work

The UI lets you click variant buttons to force a flag to a specific value. These overrides are stored in a Python dict on the backend (not in posthog-js). Overrides are applied on top of the locally-evaluated values. Clicking "Reload Flags from Server" clears all overrides.

## Feature Flags

Three demo flags with hedgehog GIF displays:

| Flag | Type | Values |
|---|---|---|
| `hog-spin` | Boolean | `true` / `false` |
| `hog-dance` | Multivariate | `sonic`, `cgi`, `triple` |
| `hog-action` | Multivariate | `run`, `sleep`, `swim` |

Each variant shows a different hedgehog GIF. The "All Project Flags" section shows every flag on the project with its current value.

## Files

| File | Purpose |
|---|---|
| `app.py` | Flask backend — serves HTML, exposes flag evaluation API |
| `flag_cache.py` | PostHog Python SDK local evaluation + caching + overrides |
| `templates/index.html` | Single-page dark mode UI |
| `static/js/app.js` | Frontend display layer — fetches flags from backend, renders GIFs, handles events/errors/identification |
| `static/css/style.css` | Dark theme styles |

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/flags?distinct_id=...` | GET | Get the 3 demo flag values (cached, locally evaluated) |
| `/api/flags/all?distinct_id=...` | GET | Get ALL project flags |
| `/api/flags/reload` | POST | Re-fetch flag definitions from PostHog, clear overrides |
| `/api/flags/override` | POST | Set a manual override for a flag |
| `/api/flags/clear-overrides` | POST | Remove all manual overrides |
| `/api/status` | GET | Server health check |

## PostHog Features Demonstrated

- **Local feature flag evaluation** — Python SDK evaluates flags using cached definitions, no per-request API calls
- **Events** — Quick-fire buttons and custom event form via `posthog.capture()`
- **Error tracking** — Send test exceptions via `posthog.captureException()`
- **User identification** — `posthog.identify()` with person properties, persisted across page refreshes via localStorage
- **All project flags** — View every flag on the project with applied/not-applied status
