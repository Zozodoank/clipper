#!/bin/bash
git pull
cd server && npm install --ignore-scripts
cd ../client && npm install
cd ..
echo "Pembaruan selesai! Silakan jalankan node dev-runner.js"