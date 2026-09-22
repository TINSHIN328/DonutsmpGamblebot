#!/bin/bash
# ============================================================
# DonutSMP Discord Bot - Installation Script
# ============================================================
# This script sets up the bot on a fresh VPS (Ubuntu/Debian).
# Run: bash install.sh
# ============================================================

set -e

echo "🍩 DonutSMP Discord Bot Installer"
echo "=================================="
echo ""

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed."
    echo "   Install Node.js 22+ from https://nodejs.org/"
    echo "   Or run: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "   Then: sudo apt-get install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "❌ Node.js version $NODE_VERSION detected. Version 22+ is required."
    exit 1
fi
echo "✅ Node.js $(node -v) detected."

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi
echo "✅ npm $(npm -v) detected."

# Create required directories
echo ""
echo "📁 Creating directories..."
mkdir -p data/backups
mkdir -p logs
echo "   ✅ ./data/"
echo "   ✅ ./data/backups/"
echo "   ✅ ./logs/"

# Install npm dependencies
echo ""
echo "📦 Installing npm dependencies..."
npm install
echo "   ✅ Dependencies installed."

# Create .env if missing
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env from .env.example..."
    cp .env.example .env
    echo "   ✅ .env created. Please edit it with your configuration:"
    echo "      nano .env"
else
    echo ""
    echo "📝 .env already exists. Skipping."
fi

# Initialize database
echo ""
echo "🗄️  Initializing database..."
node -e "
const { initDatabase } = require('./src/database.js');
initDatabase();
console.log('   ✅ Database initialized.');
"

# Register Discord commands
echo ""
echo "📋 To register Discord commands, run:"
echo "   node src/index.js --register-commands"
echo ""

# Install PM2 if not present
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
    echo "   ✅ PM2 installed."
else
    echo "✅ PM2 already installed."
fi

echo ""
echo "=================================="
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your credentials: nano .env"
echo "  2. Register Discord commands: node src/index.js --register-commands"
echo "  3. Start the bot: pm2 start ecosystem.config.cjs"
echo "  4. Save PM2 config: pm2 save"
echo "  5. Set up PM2 startup: pm2 startup"
echo ""
echo "For more info, see README.md"
echo "=================================="
