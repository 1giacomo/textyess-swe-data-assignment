import os


DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5433/shopify"
)
BACKFILL_URL = os.environ.get("BACKFILL_URL", "http://host.docker.internal:3001")
BACKFILL_TOKEN = os.environ.get("BACKFILL_TOKEN", "any-token")
RECONCILE_INTERVAL_SECONDS = int(os.environ.get("RECONCILE_INTERVAL_SECONDS", "30"))
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2024-10")
POOL_MIN_SIZE = int(os.environ.get("POOL_MIN_SIZE", "10"))
POOL_MAX_SIZE = int(os.environ.get("POOL_MAX_SIZE", "20"))
