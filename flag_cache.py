"""
PostHog Feature Flag Local Evaluation + Cache

HOW LOCAL EVALUATION WORKS:
  1. On startup, the PostHog Python SDK fetches all flag definitions from
     PostHog's servers (requires a Personal API Key).
  2. The SDK stores these definitions in memory and polls for updates
     every 30 seconds automatically.
  3. When we call get_feature_flag(..., only_evaluate_locally=True),
     the SDK evaluates the flag using the local definitions — NO network
     call is made. This is fast and works offline after the initial fetch.

HOW THE CACHE WORKS:
  - We add a second cache layer on top of local evaluation.
  - After evaluating flags for a user, we store the results for 30 seconds.
  - Repeated requests within the TTL return instantly without re-evaluating.
  - The cache is invalidated when the distinct_id changes or the TTL expires.

HOW OVERRIDES WORK:
  - The UI can set manual overrides (e.g., force hog-spin to true).
  - Overrides are stored in a simple dict and applied on top of evaluated values.
  - Clicking "Reload" clears all overrides and re-fetches from PostHog.
"""

import time
from posthog import Posthog


class FlagCache:
    # The three demo flags we evaluate
    FLAG_KEYS = ["hog-spin", "hog-dance", "hog-action"]

    # How long to cache evaluated results before re-evaluating
    CACHE_TTL = 30  # seconds

    def __init__(self, project_api_key, personal_api_key, host):
        # Initialize the PostHog Python SDK.
        # The personal_api_key is what enables local evaluation —
        # it allows the SDK to download flag definitions from PostHog.
        self.client = Posthog(
            project_api_key,
            personal_api_key=personal_api_key,
            host=host,
        )

        # Cache storage
        self._cache = {}            # {flag_key: evaluated_value}
        self._cache_time = 0        # timestamp of last evaluation
        self._cached_distinct_id = None  # which user the cache is for

        # Manual overrides set via the UI
        self._overrides = {}  # {flag_key: override_value}

    # ── Getting flag values ──

    def get_flags(self, distinct_id="anonymous"):
        """
        Get the three demo flag values for a user.

        Steps:
          1. Check if we have a fresh cache for this user.
          2. If yes, use the cached values. If no, evaluate flags locally.
          3. Apply any manual overrides on top.
          4. Return the final values.
        """
        # Step 1: Is the cache still fresh for this user?
        now = time.time()
        cache_age = now - self._cache_time
        same_user = self._cached_distinct_id == distinct_id

        if cache_age < self.CACHE_TTL and same_user:
            # Step 2a: Cache is fresh — use it
            evaluated = dict(self._cache)
        else:
            # Step 2b: Cache is stale or user changed — re-evaluate
            evaluated = self._evaluate_flags(distinct_id)

        # Step 3: Apply manual overrides on top of evaluated values
        final = dict(evaluated)
        for key in self._overrides:
            if key in final:
                final[key] = self._overrides[key]

        # Step 4: Return the merged result
        return final

    def _evaluate_flags(self, distinct_id):
        """
        Evaluate each flag locally using the PostHog Python SDK.

        This calls posthog.get_feature_flag() with only_evaluate_locally=True,
        which means:
          - NO network call is made per evaluation
          - The SDK uses the flag definitions it already has in memory
          - Results depend on the flag's targeting rules and the distinct_id

        Returns a dict like:
          {"hog-spin": True, "hog-dance": "sonic", "hog-action": "run"}
        """
        results = {}

        for flag_key in self.FLAG_KEYS:
            # Evaluate this flag for the given user, using local definitions only
            value = self.client.get_feature_flag(
                flag_key,
                distinct_id,
                only_evaluate_locally=True,
            )
            results[flag_key] = value

        # Update the cache
        self._cache = results
        self._cache_time = time.time()
        self._cached_distinct_id = distinct_id

        return results

    # ── Reload ──

    def reload(self, distinct_id="anonymous"):
        """
        Force-refresh flag definitions from PostHog, clear overrides,
        and re-evaluate all flags.

        This is useful when you've just created or changed a flag in
        PostHog and don't want to wait for the automatic 30s poll.
        """
        # Tell the SDK to re-fetch flag definitions from PostHog right now
        self.client.load_feature_flags()

        # Clear the cache so we re-evaluate
        self._cache_time = 0

        # Clear all manual overrides
        self._overrides = {}

        # Re-evaluate and return fresh values
        return self.get_flags(distinct_id)

    # ── Overrides (for the UI demo) ──

    def set_override(self, key, value):
        """Set a manual override for a flag. This value takes priority over evaluation."""
        self._overrides[key] = value

    def clear_overrides(self):
        """Remove all manual overrides. Flags go back to their evaluated values."""
        self._overrides = {}

    def get_overrides(self):
        """Return a copy of the current overrides dict."""
        return dict(self._overrides)

    # ── All flags (for the "All Project Flags" section) ──

    def get_all_flags(self, distinct_id="anonymous"):
        """
        Get ALL flags on the project (not just the three demo ones).
        Uses the SDK's get_all_flags() with local evaluation.
        Overrides are applied on top.
        """
        raw = self.client.get_all_flags(distinct_id, only_evaluate_locally=True)

        # Apply overrides
        merged = dict(raw)
        for key in self._overrides:
            if key in merged:
                merged[key] = self._overrides[key]

        return merged

    # ── Utilities ──

    def cache_age(self):
        """How many seconds since the cache was last populated."""
        if self._cache_time == 0:
            return None
        return round(time.time() - self._cache_time, 1)

    def shutdown(self):
        """Clean up the PostHog client (call on app shutdown)."""
        self.client.shutdown()
