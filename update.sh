#!/bin/bash
set -e
echo "🔄 [Update] Menjalankan git pull..."
git pull origin main || git pull || true

echo "📦 [Update] Menginstall dependency server..."
cd server && npm install --ignore-scripts
cd ..

echo "📦 [Update] Menginstall dependency client..."
cd client && npm install
cd ..

echo "✅ [Update] Pembaruan selesai!"