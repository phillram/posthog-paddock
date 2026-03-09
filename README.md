# PostHog Paddock 🦔

A Python (Flask) + vanilla JavaScript demo app showcasing PostHog features — events, error tracking, user identification, and **server-side locally-evaluated feature flags with caching**.

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Copy and fill in your .env
cp .env.example .env
# Edit .env with your keys

# 3. Run
python app.py
```

Open [http://localhost:5111](http://localhost:5111).

## Environment Variables

| Variable | Description |
|---|---|
| `POSTHOG_PROJECT_API_KEY` | Your project API key (`phc_...`) |
| `POSTHOG_PERSONAL_API_KEY` | Your personal API key (`phx_...`) — required for local flag evaluation |
| `POSTHOG_HOST` | `https://us.i.posthog.com` or `https://eu.i.posthog.com` |

## Feature Flags

Three flags are evaluated server-side with local evaluation and cached:

| Flag | Type | Values |
|---|---|---|
| `hog-spin` | Boolean | `true` / `false` |
| `hog-dance` | Multivariate | `sonic`, `cgi`, `triple` |
| `hog-action` | Multivariate | `run`, `sleep`, `swim` |

Each value displays a different hedgehog GIF. The frontend fetches cached results from `/api/flags`.

## Architecture

- **Backend**: Flask serves the HTML and exposes `/api/flags` (cached, locally-evaluated flags)
- **Frontend**: Vanilla JS with `posthog-js` for client-side events/identification
- **Flag evaluation**: PostHog Python SDK evaluates flags locally (no per-request API calls), results cached for 30s
