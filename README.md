# 🍩 DonutSMP Discord Bot

A production-ready Discord bot for the DonutSMP Minecraft server featuring a complete virtual economy, gambling games, wallet system, and Minecraft integration.

## ⚠️ Important

This bot handles **virtual in-game DonutSMP money only**. There is no real-money processing, cryptocurrency, or payment integration.

---

## 📋 Requirements

- **Node.js 22+** (LTS recommended)
- **Linux VPS** (Ubuntu 22.04+ or Debian 12+ recommended)
- **Discord Bot Application** with proper permissions
- **Microsoft Account** for Minecraft bot authentication
- **PM2** (installed automatically by the setup script)

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone <your-repo-url>
cd donutsmp-bot

# Run the installation script
bash install.sh

# Edit your configuration
nano .env

# Register Discord commands
node src/index.js --register-commands

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## 📁 Project Structure

```
donutsmp-bot/
├── src/
│   ├── index.js          # Main entry point
│   ├── config.js          # Configuration (Zod validation)
│   ├── logger.js          # Pino logger (credential-safe)
│   ├── database.js        # SQLite schema, migrations, operations
│   ├── economy.js         # Wallet, tax calculation (15% on profit)
│   ├── gambling.js        # Game engine (all games)
│   ├── provably-fair.js   # Provably fair randomness
│   ├── minecraft.js       # Mineflayer bot connection
│   ├── auth.js            # Account linking system
│   ├── security.js        # Rate limiting, anti-abuse
│   ├── events.js          # Discord commands & interactions
│   ├── ui.js              # Embeds, buttons, pagination
│   └── recovery.js        # Crash recovery worker
├── tests/
│   └── economy.test.js    # Economy & tax tests
├── data/                  # Auto-created
│   ├── database.sqlite    # Auto-created
│   └── backups/           # Auto-created
├── logs/                  # Auto-created
├── .env.example           # Configuration template
├── ecosystem.config.cjs   # PM2 configuration
├── install.sh             # VPS installation script
├── package.json
└── README.md
```

---

## 🔧 Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
nano .env
```

### Required Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your Discord bot token |
| `DISCORD_CLIENT_ID` | Your Discord application client ID |
| `ADMIN_ROLE_ID` | Discord role ID for bot administrators |
| `MC_HOST` | Minecraft server address |
| `MC_PORT` | Minecraft server port (default: 25565) |
| `MC_USERNAME` | Microsoft account email for MC bot |

### Economy Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `GAME_TAX_PERCENT` | 15 | Tax on gambling profits (%) |
| `WITHDRAW_TAX_PERCENT` | 10 | Tax on withdrawals (%) |
| `MIN_BET` | 1,000 | Minimum bet amount |
| `MAX_BET` | 100,000,000 | Maximum bet amount |
| `BIG_WIN_THRESHOLD` | 100,000,000 | Net profit for big win announcement |
| `STARTING_BALANCE` | 1,000,000 | Initial wallet balance |

### Anti-Abuse Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_DAILY_WAGER` | 500,000,000 | Daily wager limit |
| `MAX_WITHDRAW_PER_DAY` | 100,000,000 | Daily withdrawal limit |
| `WITHDRAW_COOLDOWN_SECONDS` | 300 | Cooldown between withdrawals |
| `COINFLIP_COOLDOWN_SECONDS` | 5 | Cooldown between games |

---

## 🎮 Discord Setup

### 1. Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Go to "Bot" section
4. Click "Add Bot"
5. Enable "Message Content Intent"
6. Copy the **Bot Token** → `DISCORD_TOKEN`
7. Go to "OAuth2" → "General"
8. Copy the **Client ID** → `DISCORD_CLIENT_ID`

### 2. Bot Permissions

Invite the bot with these permissions:
- `applications.commands` (Slash commands)
- `Send Messages`
- `Embed Links`
- `Read Message History`
- `Use External Emojis`

**Invite URL:**
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274878286080&scope=bot%20applications.commands
```

### 3. Admin Role

1. Create a role in your Discord server (e.g., "Bot Admin")
2. Copy the Role ID (enable Developer Mode in Discord settings)
3. Set `ADMIN_ROLE_ID` in `.env`

---

## 🔗 Account Linking (Payment Verification)

The bot uses a **Minecraft payment verification** system to link accounts. No passwords are ever collected.

### How It Works

1. User runs `/link` in Discord
2. Bot generates a **random challenge amount** (1-100) using `crypto.randomInt()`
3. User joins DonutSMP in Minecraft and sends: `/pay <BotUsername> <challenge_amount>`
4. The Minecraft bot detects the payment automatically
5. If the amount matches an active challenge, the account is linked

### Security

- Challenge amounts are **cryptographically random** (never `Math.random()`)
- Each session has a unique ID, expiration, and amount
- **Duplicate payments are prevented** via SHA-256 hashing
- **Ambiguous payments** (same amount from multiple users) are safely rejected
- The verification payment is **NOT** credited to the wallet
- No Microsoft passwords are ever stored or transmitted

### Example Flow

```
User: /link
Bot: 🔗 Send /pay ZpSniper 73 (expires in 5 min)
User: /pay ZpSniper 73 (in Minecraft)
Bot: ✅ Account linked! Minecraft: ZpSniper123
```

### Concurrent Users

Multiple users can link simultaneously. The system:
- Generates unique challenge amounts when possible
- Detects and rejects ambiguous payments
- Never links the wrong account

## 💰 Deposit System

Deposits use a similar challenge-based verification:

1. User runs `/deposit 1000000`
2. Bot generates a unique challenge amount (different from deposit amount)
3. User sends the **challenge amount** in Minecraft
4. Bot detects payment and credits the **requested deposit amount** to wallet
5. The challenge amount identifies the deposit session

**Important:** The challenge amount is NOT the deposit amount. It's used to uniquely identify your deposit session.

---

## 🗄️ Database

The bot uses **SQLite** for simplicity and reliability on a single VPS.

### Automatic Setup

The database is created automatically on first startup:
- Schema is created
- Migrations are applied
- Default settings are inserted
- Indexes are created

**Location:** `./data/database.sqlite`

### Automatic Backups

- Backups are created every 6 hours (configurable)
- Stored in `./data/backups/`
- Old backups are automatically cleaned (7-day retention)
- A backup is created before every migration

### Manual Backup

```bash
cp data/database.sqlite data/backups/manual-$(date +%Y%m%d).sqlite
```

---

## 🎰 Commands

### User Commands

#### 💰 Economy
| Command | Description |
|---------|-------------|
| `/balance` | View your wallet balance |
| `/wallet` | View detailed wallet stats |
| `/deposit <amount>` | Deposit MC money to gambling wallet |
| `/withdraw <amount>` | Withdraw to your MC account |
| `/pay <user> <amount>` | Send money to another player |
| `/history` | View transaction/game history |
| `/info` | View economy rules and info |

#### 🎰 Games
| Command | Description |
|---------|-------------|
| `/coinflip <bet>` | Flip a coin (2x payout) |
| `/blackjack <bet>` | Play Blackjack with Hit/Stand/Double |
| `/roulette <bet> <type>` | Play roulette (2x-36x) |
| `/slots <bet>` | Slot machine with symbol matching |
| `/dice <bet> <number>` | Pick a number 1-6 (6x payout) |
| `/chicken <bet>` | Cross the road, cash out before hit |
| `/keno <bet> <numbers>` | Pick up to 10 numbers |
| `/limbo <bet> <target>` | Set target multiplier |
| `/mines <bet> <mines>` | Reveal tiles, avoid mines |
| `/tower <bet>` | Climb tower floor by floor |

#### 👤 Account
| Command | Description |
|---------|-------------|
| `/link` | Link your Discord to Minecraft account |
| `/unlink` | Unlink your account |
| `/profile` | View your player profile |
| `/account` | View your account info |

#### 🏆 Rewards
| Command | Description |
|---------|-------------|
| `/baltop` | View richest players leaderboard |
| `/games` | View all available games |
| `/redeem <code>` | Redeem a promo code |
| `/rakeback` | View and claim rakeback |
| `/invites` | View your referral invites |
| `/advertisement` | View ad reward info |

#### 🔐 Fairness
| Command | Description |
|---------|-------------|
| `/provablyfair` | Learn about provably fair system |
| `/verify <game_id>` | Verify game fairness |

#### ⚙️ Utility
| Command | Description |
|---------|-------------|
| `/status` | View bot status |
| `/help` | View all commands |
| `/refreshroles` | Sync roles based on stats |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/setchannel <type> <channel>` | Set win/logs channel |
| `/setconfig <key> <value>` | Update bot setting |
| `/getconfig` | View current config |
| `/addbalance <user> <amount> <reason>` | Add balance |
| `/removebalance <user> <amount> <reason>` | Remove balance |
| `/userinfo <user>` | View user details |
| `/maintenance <on/off>` | Toggle maintenance mode |
| `/database-status` | View database info |
| `/refund <game_id>` | Refund a game |
| `/transaction <id>` | View transaction details |

---

## 💰 Economy System

### Tax Calculation

**Game Tax: 15% on PROFIT (not on bet)**

```
Example:
Starting balance: $1,000,000
Bet: $1,000,000
Win (2x payout): $2,000,000

Gross Profit: $1,000,000
Game Tax (15%): $150,000
Net Profit: $850,000
Final Balance: $1,850,000
```

**On losses:** No tax is charged.

### Transaction Safety

- All monetary operations are atomic (SQLite transactions)
- Every balance change creates an immutable transaction record
- Race conditions prevented via database locking
- Double-spending impossible
- Integer-only math (no floating point)
- Crash recovery for incomplete operations

### Transaction Types

- `DEPOSIT` - Money added from MC
- `WITHDRAW` - Money sent to MC
- `BET` / `RESERVATION` - Bet placed
- `WIN` / `LOSS` - Game result
- `TAX` - Tax deducted
- `REFUND` - Failed operation refunded
- `ADMIN_ADJUSTMENT` - Admin balance change

---

## 🎲 Games

All games use **provably fair** randomness:
- Server seed (hashed and committed before game)
- Client seed (generated per game)
- Nonce (timestamp-based)
- Verifiable with `/verify <game_id>`

### Available Games

| Game | Payout | Interactive | Description |
|------|--------|-------------|-------------|
| 🪙 Coinflip | 2x | No | Pick heads or tails |
| ♠️ Blackjack | 2x-2.5x | Yes | Hit/Stand/Double against dealer |
| 🎡 Roulette | 2x-36x | No | Bet on color/number/odd/even |
| 🎰 Slots | 1.5x-50x | No | Match 3 symbols |
| 🎲 Dice | 6x | No | Pick a number 1-6 |
| 🐔 Chicken | 1.4x/row | Yes | Cross road, cash out before hit |
| 🎯 Keno | 1x-10000x | No | Pick up to 10 numbers |
| 🚀 Limbo | 1.01x-1000x | No | Set target multiplier |
| 💣 Mines | Dynamic | Yes | Reveal tiles, avoid mines, cash out |
| 🏗️ Tower | Dynamic | Yes | Climb floors, cash out safely |
| 📊 High/Low | 2x/10x | No | Guess high or low |
| 📈 Crash | 1.01x-100x | No | Cash out before crash |

---

## 🔒 Security

### What the bot does:
- ✅ Validates all inputs with Zod schemas
- ✅ Uses integer-only money math
- ✅ Atomic database transactions
- ✅ Rate limiting on all commands
- ✅ Cooldowns on gambling
- ✅ Daily wager/withdrawal limits
- ✅ Crash recovery for incomplete operations
- ✅ Never logs credentials
- ✅ Redacts sensitive data in logs
- ✅ Provably fair gambling

### What the bot NEVER does:
- ❌ Store Microsoft passwords
- ❌ Expose tokens in messages/logs
- ❌ Use Math.random() for gambling
- ❌ Allow negative balances
- ❌ Process duplicate transactions
- ❌ Trust client-side balances

---

## 🖥️ VPS Deployment

### Ubuntu/Debian Setup

```bash
# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and install
git clone <repo>
cd donutsmp-bot
bash install.sh

# Configure
nano .env

# Register commands
node src/index.js --register-commands

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup

# Enable auto-start on reboot
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
```

### PM2 Management

```bash
pm2 status              # Check status
pm2 logs donutsmp-bot   # View logs
pm2 restart donutsmp-bot # Restart
pm2 stop donutsmp-bot    # Stop
pm2 monit               # Monitor
```

---

## 🧪 Testing

Run the economy tests:

```bash
node tests/economy.test.js
```

Tests verify:
- ✅ 15% tax on profit (not bet)
- ✅ No tax on losses
- ✅ Integer-only math
- ✅ No negative balances
- ✅ Crash recovery logic
- ✅ Provably fair determinism

---

## 🔄 Updating

```bash
cd donutsmp-bot
git pull
npm install
# Database migrations run automatically on next start
pm2 restart donutsmp-bot
```

---

## 🐛 Troubleshooting

### Bot won't start
- Check `.env` has all required values
- Check Node.js version: `node -v` (need 22+)
- Check logs: `pm2 logs donutsmp-bot`

### Minecraft bot won't connect
- Verify MC_HOST and MC_PORT are correct
- Check Microsoft auth: run `node src/index.js` and follow the auth prompt
- Check server isn't full

### Commands not showing
- Run: `node src/index.js --register-commands`
- Wait a few minutes for Discord to sync
- Try kicking and re-inviting the bot

### Database issues
- Check `./data/` directory permissions
- View status: `/database-status` command
- Manual backup before any changes

---

## 📝 License

Private - DonutSMP Server Bot

---

## 🙏 Credits

Made by Zyro
