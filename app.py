"""
PostHog Paddock — Flask Backend

This server does two things:
  1. Serves the frontend HTML/JS/CSS
  2. Evaluates feature flags locally using the PostHog Python SDK

All feature flag evaluation happens HERE on the Python side.
The JavaScript frontend only displays the results — it never
evaluates flags itself.

The posthog-js SDK on the frontend is used ONLY for:
  - Sending events (posthog.capture)
  - Identifying users (posthog.identify)
  - Tracking errors (posthog.captureException)
"""

import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from flag_cache import FlagCache

load_dotenv()

app = Flask(__name__)

# ── PostHog Configuration ──
# These come from .env — see .env.example for the template.
# PROJECT_API_KEY (phc_...): Identifies your PostHog project.
# PERSONAL_API_KEY (phx_...): Required for local flag evaluation.
#   This key lets the Python SDK download flag definitions.
# POSTHOG_HOST: Either US (us.i.posthog.com) or EU (eu.i.posthog.com).

PROJECT_API_KEY = os.getenv("POSTHOG_PROJECT_API_KEY", "")
PERSONAL_API_KEY = os.getenv("POSTHOG_PERSONAL_API_KEY", "")
POSTHOG_HOST = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com")

# Initialize the flag cache if both keys are configured
flag_cache = None
if PROJECT_API_KEY and PERSONAL_API_KEY:
    flag_cache = FlagCache(PROJECT_API_KEY, PERSONAL_API_KEY, POSTHOG_HOST)


# ── Page Route ──

@app.route("/")
def index():
    """Serve the main page. The project API key and host are passed
    to the template so the frontend can initialize posthog-js."""
    return render_template(
        "index.html",
        project_api_key=PROJECT_API_KEY,
        posthog_host=POSTHOG_HOST,
    )


# ── Feature Flag API Routes ──
# All flag evaluation happens in Python. The frontend calls these
# endpoints and displays the results.

@app.route("/api/flags")
def get_flags():
    """
    GET /api/flags?distinct_id=user_123

    Returns the three demo flag values for a user.
    Values come from local evaluation (cached for 30s).
    Any manual overrides are applied on top.
    """
    if not flag_cache:
        return jsonify({"error": "PostHog not configured. Set .env variables."}), 503

    distinct_id = request.args.get("distinct_id", "anonymous")

    # Evaluate flags locally (or return cached values)
    flags = flag_cache.get_flags(distinct_id)

    # Also return which flags are overridden, so the UI can show it
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
    """
    POST /api/flags/reload

    Force-refresh flag definitions from PostHog, clear all overrides,
    and re-evaluate. Use this after changing flags in the PostHog UI.
    """
    if not flag_cache:
        return jsonify({"error": "PostHog not configured. Set .env variables."}), 503

    distinct_id = request.json.get("distinct_id", "anonymous") if request.json else "anonymous"

    # This re-fetches definitions, clears overrides, and re-evaluates
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
    """
    POST /api/flags/override
    Body: {"key": "hog-spin", "value": true, "distinct_id": "user_123"}

    Set a manual override for a flag. This is used by the UI's variant
    buttons to force a flag to a specific value for testing.
    The override takes priority over the locally-evaluated value.
    """
    if not flag_cache:
        return jsonify({"error": "PostHog not configured. Set .env variables."}), 503

    data = request.json or {}
    key = data.get("key")
    value = data.get("value")

    if not key:
        return jsonify({"error": "Missing 'key' in request body."}), 400

    # Store the override on the Python backend
    flag_cache.set_override(key, value)

    # Return updated flags (with the new override applied)
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
    """
    POST /api/flags/clear-overrides

    Remove all manual overrides. Flags go back to their
    locally-evaluated values.
    """
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
    """
    GET /api/flags/all?distinct_id=user_123

    Returns ALL flags on the project (not just the three demo ones).
    Used by the "All Project Flags" section in the UI.
    """
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
    """GET /api/status — Server health check."""
    return jsonify({
        "posthog_configured": flag_cache is not None,
        "cache_ttl_seconds": FlagCache.CACHE_TTL if flag_cache else None,
        "cache_age_seconds": flag_cache.cache_age() if flag_cache else None,
        "posthog_host": POSTHOG_HOST,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5111)
