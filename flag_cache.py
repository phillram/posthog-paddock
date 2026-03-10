import time
from posthog import Posthog


class FlagCache:
    """Evaluates all PostHog feature flags locally using the Python SDK."""

    FLAG_KEYS = ["hog-spin", "hog-dance", "hog-action"]
    CACHE_TTL = 30  # seconds

    def __init__(self, project_api_key, personal_api_key, host):
        self.client = Posthog(
            project_api_key,
            personal_api_key=personal_api_key,
            host=host,
        )
        self._cache = {}
        self._cache_time = 0
        self._cached_distinct_id = None
        self._overrides = {}  # manual overrides set via the UI

    def get_flags(self, distinct_id="anonymous"):
        """Return cached flags if fresh, otherwise re-evaluate. Overrides applied on top."""
        now = time.time()
        cache_is_fresh = (
            (now - self._cache_time) < self.CACHE_TTL
            and self._cached_distinct_id == distinct_id
        )

        if cache_is_fresh:
            evaluated = dict(self._cache)
        else:
            evaluated = self._evaluate_flags(distinct_id)

        # Apply manual overrides on top of evaluated values
        merged = dict(evaluated)
        for key, value in self._overrides.items():
            if key in merged:
                merged[key] = value

        return merged

    def get_evaluated_flags(self, distinct_id="anonymous"):
        """Return the raw evaluated values WITHOUT overrides (for source comparison)."""
        now = time.time()
        cache_is_fresh = (
            (now - self._cache_time) < self.CACHE_TTL
            and self._cached_distinct_id == distinct_id
        )

        if cache_is_fresh:
            return dict(self._cache)

        return dict(self._evaluate_flags(distinct_id))

    def _evaluate_flags(self, distinct_id):
        """Evaluate all flags locally using the PostHog Python SDK."""
        results = {}
        for key in self.FLAG_KEYS:
            results[key] = self.client.get_feature_flag(
                key,
                distinct_id,
                only_evaluate_locally=True,
            )
        self._cache = results
        self._cache_time = time.time()
        self._cached_distinct_id = distinct_id
        return results

    def reload(self, distinct_id="anonymous"):
        """Force-refresh flag definitions from PostHog, then re-evaluate."""
        self.client.load_feature_flags()
        self._cache_time = 0
        self._overrides = {}
        return self.get_flags(distinct_id)

    def set_override(self, key, value):
        """Set a manual override for a flag."""
        self._overrides[key] = value

    def clear_overrides(self):
        """Remove all manual overrides."""
        self._overrides = {}

    def get_overrides(self):
        """Return the current override dict."""
        return dict(self._overrides)

    def get_all_flags(self, distinct_id="anonymous"):
        """Return all feature flags for a user, with overrides applied."""
        raw = self.client.get_all_flags(distinct_id, only_evaluate_locally=True)
        merged = dict(raw)
        for key, value in self._overrides.items():
            if key in merged:
                merged[key] = value
        return merged

    def get_all_flags_raw(self, distinct_id="anonymous"):
        """Return all flags WITHOUT overrides."""
        return self.client.get_all_flags(distinct_id, only_evaluate_locally=True)

    def cache_age(self):
        """Return how many seconds since the cache was last populated."""
        if self._cache_time == 0:
            return None
        return round(time.time() - self._cache_time, 1)

    def shutdown(self):
        """Clean up the PostHog client."""
        self.client.shutdown()
