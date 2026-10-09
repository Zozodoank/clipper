#!/bin/bash
set -e

echo "Ensuring Termux wake-lock is active..."
termux-wake-lock || true

if [ -z "$KAGGLE_USERNAME" ] || [ -z "$KAGGLE_KEY" ]; then
    if [ ! -f ~/.kaggle/kaggle.json ]; then
        echo "ERROR: KAGGLE_USERNAME and KAGGLE_KEY must be set in .env or ~/.kaggle/kaggle.json"
        echo "Get your API token from kaggle.com -> Settings -> API -> Create New Token"
        exit 1
    fi
fi

echo "Starting Kaggle Oracle (VLM)..."
URL=$(python scripts/start_kaggle_oracle.py)

if [ "$URL" = "mock://localhost" ]; then
    export VLM_PROVIDER="mock"
else
    export VLM_PROVIDER="oracle"
    export VLM_ORACLE_URL="$URL"
fi

echo "Starting main FastAPI backend..."
exec uvicorn app.main:app --host 0.0.0.0 --port 5000
