FROM python:3.11-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]

# --- Dev target (base + test tooling + heavy ML so local in-process embedding works) ---
FROM base AS dev
COPY requirements-dev.txt requirements-ml.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt -r requirements-ml.txt
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# --- Embedding worker target (base + heavy ML; GPU at runtime) ---
# Runs the ARQ worker that processes embedding/inference jobs off the lean API.
# Activating offload also requires Redis + switching enqueue to ARQ (see jobs/worker.py).
FROM base AS worker
COPY requirements-ml.txt .
RUN pip install --no-cache-dir -r requirements-ml.txt
CMD ["arq", "app.jobs.worker.WorkerSettings"]

