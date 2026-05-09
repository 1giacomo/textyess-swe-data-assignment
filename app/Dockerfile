FROM python:3.11-slim

WORKDIR /app

# Copy build metadata first for layer caching, then install with dev extras
# (tests run inside the container).
COPY pyproject.toml ./
COPY src/ ./src/
COPY tests/ ./tests/
RUN pip install --no-cache-dir ".[dev]"

EXPOSE 3000

CMD ["uvicorn", "shopify_app.main:app", "--host", "0.0.0.0", "--port", "3000"]
