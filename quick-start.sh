#!/bin/bash

# Script khởi động nhanh cho Linux Mint
# Chạy: bash quick-start.sh

echo "🚀 Kiểm tra môi trường..."

# Kiểm tra Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js chưa được cài đặt!"
    echo "Cài đặt: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    exit 1
fi

echo "✓ Node.js: $(node --version)"
echo "✓ npm: $(npm --version)"

# Kiểm tra service account key
if [ ! -f "service-account-key.json" ]; then
    echo "⚠️  Chưa tìm thấy service-account-key.json"
    echo "Vui lòng tải file JSON từ Google Cloud Console và đặt vào thư mục này"
    echo "Xem hướng dẫn trong SETUP_LINUX.md"
    exit 1
fi

echo "✓ Đã tìm thấy service-account-key.json"

# Kiểm tra node_modules
if [ ! -d "node_modules" ]; then
    echo "📦 Đang cài đặt dependencies..."
    npm install
fi

echo ""
echo "✅ Sẵn sàng chạy!"
echo ""
echo "Mở 2 terminal windows và chạy:"
echo "  Terminal 1: npm run dev:server"
echo "  Terminal 2: npm run dev"
echo ""
echo "Sau đó mở trình duyệt: http://localhost:3000"


