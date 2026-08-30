#!/bin/bash
set -e
echo "🔄 [Update] Mengambil update terbaru dari GitHub..."
git fetch origin main
git reset --hard origin/main

echo "📦 [Update] Menginstall dependency server..."
cd server && npm install --ignore-scripts
cd ..

echo "📦 [Update] Menginstall dependency client..."
cd client && npm install
cd ..

echo "✅ [Update] Pembaruan selesai! Berada di commit: $(git log -1 --oneline)"