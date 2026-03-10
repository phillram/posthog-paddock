import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from flag_cache import FlagCache

load_dotenv()

app = Flask(__name__)

# --- PostHog flag cache (local evaluation on Python side) ---

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
    """Return locally-evaluated, cached feature flag values (with overrides)."""
    if not flag_cache:
        return jsonify({"error": "PostHog not configured. Set .env variables."}), 503

    distinct_id = request.args.get("distinct_id", "anonymous")
    flags = flag_cache.get_flags(distinct_id)
    overrides = flag_cache.get_overrides()

    return jsonify({
        "flags": flags,
        "overrides": overrides,
        "cache_age_seconds": flag_cache.cache_age(),
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "distinct_id": distinct_id,
    })


@app.route("/api/flags/reload", methods=["POST"])
def reload_flags():
    """Force-refresh flag definitions, clear overrides, and re-evaluate."""
    if not flag_cache:
        return jsonify({"error": "PostHog not configured. Set .env variables."}), 503

    distinct_id = request.json.get("distinct_id", "anonymous") if request.json else "anonymous"
    flags = flag_cache.reload(distinct_id)

    return jsonify({
        "flags": flags,
        "overrides": {},
        "cache_age_seconds": 0,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "distinct_id": distinct_id,
    })


@app.route("/api/flags/override", methods=["POST"])
def override_flag():
    """Set or clear a manual override for a flag (evaluated on Python side)."""
    if not flag_cache:
        return jsonify({"error": "PostHog not configured. Set .env variables."}), 503

    data = request.json or {}
    key = data.get("key")
    value = data.get("value")

    if not key:
        return jsonify({"error": "Missing 'key' in request body."}), 400

    flag_cache.set_override(key, value)

    distinct_id = data.get("distinct_id", "anonymous")
    flags = flag_cache.get_flags(distinct_id)
    overrides = flag_cache.get_overrides()

    return jsonify({
        "flags": flags,
        "overrides": overrides,
        "distinct_id": distinct_id,
    })


@app.route("/api/flags/clear-overrides", methods=["POST"])
def clear_overrides():
    """Clear all manual flag overrides."""
    if not flag_cache:
        return jsonify({"error": "PostHog not configured. Set .env variables."}), 503

    flag_cache.clear_overrides()

    distinct_id = request.json.get("distinct_id", "anonymous") if request.json else "anonymous"
    flags = flag_cache.get_flags(distinct_id)

    return jsonify({
        "flags": flags,
        "overrides": {},
        "distinct_id": distinct_id,
    })


@app.route("/api/flags/all")
def get_all_flags():
    """Return all feature flags and their values for a user (with overrides)."""
    if not flag_cache:
        return jsonify({"error": "PostHog not configured. Set .env variables."}), 503

    distinct_id = request.args.get("distinct_id", "anonymous")
    all_flags = flag_cache.get_all_flags(distinct_id)
    overrides = flag_cache.get_overrides()

    return jsonify({
        "flags": all_flags,
        "overrides": overrides,
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
