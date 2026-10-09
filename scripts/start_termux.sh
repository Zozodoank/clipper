#!/bin/bash
set -e

echo "Ensuring Termux wake-lock is active..."
termux-wake-lock || true

echo "Starting main FastAPI backend..."
exec uvicorn app.main:app --host 0.0.0.0 --port 5000
