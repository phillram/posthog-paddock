import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from flag_cache import FlagCache

load_dotenv()

app = Flask(__name__)

# --- PostHog flag cache (server-side local evaluation) ---

PROJECT_API_KEY = os.getenv("POSTHOG_PROJECT_API_KEY", "")
PERSONAL_API_KEY = os.getenv("POSTHOG_PERSONAL_API_KEY", "")
POSTHOG_HOST = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com")

flag_cache = None

if PROJECT_API_KEY and PERSONAL_API_KEY:
    flag_cache = FlagCache(PROJECT_API_KEY, PERSONAL_API_KEY, POSTHOG_HOST)


# --- Routes ---

@app.route("/")
def index():
    return render_template(
        "index.html",
        project_api_key=PROJECT_API_KEY,
        posthog_host=POSTHOG_HOST,
    )


@app.route("/api/flags")
def get_flags():
    """Return locally-evaluated, cached feature flag values."""
    if not flag_cache:
        return jsonify({"error": "PostHog not configured. Set .env variables."}), 503

    distinct_id = request.args.get("distinct_id", "anonymous")
    flags = flag_cache.get_flags(distinct_id)

    return jsonify({
        "flags": flags,
        "cache_age_seconds": flag_cache.cache_age(),
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "distinct_id": distinct_id,
    })


@app.route("/api/flags/reload", methods=["POST"])
def reload_flags():
    """Force-refresh flag definitions and re-evaluate."""
    if not flag_cache:
        return jsonify({"error": "PostHog not configured. Set .env variables."}), 503

    distinct_id = request.json.get("distinct_id", "anonymous") if request.json else "anonymous"
    flags = flag_cache.reload(distinct_id)

    return jsonify({
        "flags": flags,
        "cache_age_seconds": 0,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "distinct_id": distinct_id,
    })


@app.route("/api/status")
def status():
    """Server health and cache info."""
    return jsonify({
        "posthog_configured": flag_cache is not None,
        "cache_ttl_seconds": FlagCache.CACHE_TTL if flag_cache else None,
        "cache_age_seconds": flag_cache.cache_age() if flag_cache else None,
        "posthog_host": POSTHOG_HOST,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5111)
