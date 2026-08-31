#!/bin/bash
set -e

echo "🔄 [Update] Mengecek perubahan lokal..."
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ [Update] Dibatalkan: ada perubahan lokal yang belum di-commit."
  echo "   Commit/stash perubahan dulu sebelum menjalankan update."
  exit 1
fi

echo "🔄 [Update] Mengambil update terbaru dari GitHub (fast-forward only)..."
git fetch origin main
git pull --ff-only origin main

echo "📦 [Update] Menginstall dependency server..."
if [ -f server/package-lock.json ]; then
  (cd server && npm ci --ignore-scripts)
else
  (cd server && npm install --ignore-scripts)
fi

echo "📦 [Update] Menginstall dependency client..."
if [ -f client/package-lock.json ]; then
  (cd client && npm ci)
else
  (cd client && npm install)
fi

echo "✅ [Update] Pembaruan selesai! Berada di commit: $(git log -1 --oneline)"
