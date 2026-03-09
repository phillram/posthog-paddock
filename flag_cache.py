import time
from posthog import Posthog


class FlagCache:
    """Evaluates PostHog feature flags locally on the server and caches results."""

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

    def get_flags(self, distinct_id="anonymous"):
        """Return cached flags if fresh, otherwise re-evaluate."""
        now = time.time()
        cache_is_fresh = (
            (now - self._cache_time) < self.CACHE_TTL
            and self._cached_distinct_id == distinct_id
        )

        if cache_is_fresh:
            return self._cache

        return self._evaluate_flags(distinct_id)

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
        return self.get_flags(distinct_id)

    def cache_age(self):
        """Return how many seconds since the cache was last populated."""
        if self._cache_time == 0:
            return None
        return round(time.time() - self._cache_time, 1)

    def shutdown(self):
        """Clean up the PostHog client."""
        self.client.shutdown()
