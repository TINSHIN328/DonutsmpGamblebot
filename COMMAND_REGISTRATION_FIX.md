# DonutSMP Bot - Command Registration Fix Summary

## ✅ What Was Fixed

### 1. Command Registration System
**Problem:** Slash commands were not appearing in Discord server.

**Root Cause:** 
- No support for guild-specific command registration
- Missing `DISCORD_GUILD_ID` configuration
- No detailed logging during registration
- No command validation before registration

**Solution:**
- Added `DISCORD_GUILD_ID` to config schema (optional)
- Updated `registerCommands()` to support both guild and global registration
- Added comprehensive command validation
- Added detailed logging showing all registered commands
- Added proper error reporting with Discord API error details

### 2. Startup Sequence
**Problem:** Startup output was unclear and didn't show important information.

**Solution:**
- Redesigned startup sequence with clear status indicators
- Shows Discord login success with bot tag
- Shows guild information when GUILD_ID is set
- Shows command count and names during registration
- Shows database status and economy settings
- Clear error messages with suggested fixes

### 3. Configuration
**Problem:** Missing `DISCORD_GUILD_ID` environment variable.

**Solution:**
- Added `DISCORD_GUILD_ID` to `src/config.js` (optional field)
- Updated `.env.example` to include `DISCORD_GUILD_ID`
- Guild-specific registration provides instant command availability
- Falls back to global registration if GUILD_ID is not set

---

## 🚀 How to Use

### Step 1: Configure Environment Variables

Edit your `.env` file and add:

```env
# Discord Configuration
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_GUILD_ID=your_guild_id_here  # ← ADD THIS
ADMIN_ROLE_ID=your_admin_role_id_here

# Minecraft Configuration
MC_HOST=play.donutsmp.net
MC_PORT=25565
MC_USERNAME=your_microsoft_email
MC_AUTH=microsoft

# ... rest of your config
```

**How to get your Guild ID:**
1. Open Discord
2. Go to User Settings → Advanced → Enable Developer Mode
3. Right-click your server name
4. Click "Copy Server ID"
5. Paste it as `DISCORD_GUILD_ID`

### Step 2: Register Commands

Run the command registration script:

```bash
node src/index.js --register-commands
```

**Expected Output:**
```
====================================
  DONUTSMP GAMBLE BOT
====================================

✓ Environment loaded
✓ Directories created
✓ Database connected
✓ Migrations checked

📋 Registering Discord commands...

📋 COMMAND REGISTRATION
-----------------------------------
Total commands to register: 30
Registration type: Guild-specific
Guild ID: 123456789012345678
-----------------------------------
Commands:
  1. /link
  2. /unlink
  3. /profile
  4. /account
  5. /wallet
  6. /deposit
  7. /withdraw
  8. /history
  9. /coinflip
  10. /dice
  11. /roulette
  12. /highlow
  13. /crash
  14. /verify
  15. /status
  16. /setchannel
  17. /setconfig
  18. /getconfig
  19. /addbalance
  20. /removebalance
  21. /userinfo
  22. /maintenance
  23. /database-status
  24. /refund
  25. /transaction
  26. /balance
  27. /pay
  28. /baltop
  29. /info
  30. /blackjack
  ... and more
-----------------------------------

✅ COMMAND REGISTRATION SUCCESSFUL
-----------------------------------
Registered: 30 commands
Type: guild
Guild: 123456789012345678
-----------------------------------
```

### Step 3: Start the Bot

```bash
node src/index.js
```

**Expected Output:**
```
====================================
  DONUTSMP GAMBLE BOT
====================================

✓ Environment loaded
✓ Directories created
✓ Database connected
✓ Migrations checked
✓ Recovery worker initialized
✓ Discord client initialized
✓ Minecraft module initialized
✓ Payment monitor initialized
✓ Security module initialized

Discord:
  ✓ Logged in as DonutSMP Bot#1234
  ✓ Guild: Your Server Name (123456789012345678)
  ✓ In 1 guild(s)

📋 Registering slash commands...

📋 COMMAND REGISTRATION
-----------------------------------
Total commands to register: 30
Registration type: Guild-specific
Guild ID: 123456789012345678
-----------------------------------
Commands:
  1. /link
  2. /unlink
  ...
-----------------------------------

✅ COMMAND REGISTRATION SUCCESSFUL
...

Database:
  ✓ SQLite connected
  ✓ Size: 1.5 MB
  ✓ Pending transactions: 0

Economy:
  ✓ Game tax: 15%
  ✓ Min bet: $1,000
  ✓ Max bet: $100,000,000

====================================
  ✅ BOT IS RUNNING
====================================
```

### Step 4: Verify Commands in Discord

1. Open your Discord server
2. Type `/` in any channel
3. You should see all bot commands appear immediately
4. Try `/wallet` or `/balance` to test

---

## 📋 Required Discord Developer Portal Settings

### 1. Bot Permissions
Go to: Discord Developer Portal → Your Application → Bot

Enable these **Privileged Gateway Intents**:
- ✅ **SERVER MEMBERS INTENT** (required for role management)
- ✅ **MESSAGE CONTENT INTENT** (required for payment monitoring)
- ✅ **PRESENCE INTENT** (optional, for status features)

### 2. Bot Scopes
Go to: Discord Developer Portal → Your Application → OAuth2 → URL Generator

Select these scopes:
- ✅ `bot`
- ✅ `applications.commands`

### 3. Bot Permissions
Select these permissions:
- ✅ **Send Messages**
- ✅ **Embed Links**
- ✅ **Read Message History**
- ✅ **Use External Emojis**
- ✅ **Manage Roles** (for /refreshroles)
- ✅ **View Channels**
- ✅ **Add Reactions** (for giveaways)

### 4. Generate Invite URL
Copy the generated URL and use it to invite your bot to the server.

---

## 🔧 Troubleshooting

### Commands Not Appearing

**Problem:** Commands still don't appear after registration.

**Solutions:**
1. **Check GUILD_ID:** Make sure `DISCORD_GUILD_ID` is set in `.env`
2. **Check Bot Permissions:** Ensure bot has `applications.commands` scope
3. **Check Bot is in Server:** Verify bot is actually in the guild
4. **Restart Discord:** Sometimes Discord client needs a restart
5. **Wait for Global:** If using global registration, wait up to 1 hour

**Debug Steps:**
```bash
# Check if registration succeeded
node src/index.js --register-commands

# Look for these in output:
# ✅ COMMAND REGISTRATION SUCCESSFUL
# Registered: 30 commands
# Type: guild
```

### Registration Failed

**Error:** `401 Unauthorized`
- **Cause:** Invalid `DISCORD_TOKEN`
- **Fix:** Regenerate bot token in Discord Developer Portal

**Error:** `404 Not Found`
- **Cause:** Invalid `DISCORD_CLIENT_ID` or `DISCORD_GUILD_ID`
- **Fix:** Double-check IDs in Discord Developer Portal

**Error:** `403 Forbidden`
- **Cause:** Bot doesn't have `applications.commands` scope
- **Fix:** Re-invite bot with correct scopes

**Error:** `Missing Access`
- **Cause:** Bot doesn't have permission in the guild
- **Fix:** Re-invite bot to the server

### Bot Starts But Commands Don't Work

**Problem:** Commands appear but return errors.

**Solutions:**
1. Check bot has all required permissions
2. Verify `ADMIN_ROLE_ID` is correct
3. Check database is accessible
4. Look at logs in `./logs/` directory

---

## 📊 Command List

### User Commands (30+)
- `/link` - Link Discord to Minecraft account
- `/unlink` - Unlink Minecraft account
- `/profile` - View player profile
- `/wallet` - View wallet balance and stats
- `/balance` - Quick balance check
- `/deposit <amount>` - Deposit MC money
- `/withdraw <amount>` - Withdraw to MC
- `/pay <user> <amount>` - Send money to player
- `/history` - View transaction history
- `/baltop` - View richest players
- `/info` - View economy information

### Game Commands (10)
- `/coinflip <bet>` - 2x payout
- `/blackjack <bet>` - Interactive blackjack
- `/roulette <bet> <type>` - 2x-36x payout
- `/slots <bet>` - Slot machine
- `/dice <bet> <number>` - 6x payout
- `/chicken <bet>` - Cross the road
- `/keno <bet> <numbers>` - Pick numbers
- `/limbo <bet> <target>` - Target multiplier
- `/mines <bet> <mines>` - Avoid mines
- `/tower <bet>` - Climb tower

### Reward Commands
- `/redeem <code>` - Redeem promo code
- `/rakeback` - Claim rakeback
- `/invites` - View referral invites
- `/advertisement` - View ad rewards
- `/games` - View all games

### Fairness Commands
- `/provablyfair` - Learn about fairness
- `/verify <game-id>` - Verify game result

### Utility Commands
- `/status` - View bot status
- `/help` - View all commands
- `/refreshroles` - Sync roles

### Admin Commands
- `/setchannel <type> <channel>` - Set win/logs channel
- `/setconfig <key> <value>` - Update config
- `/getconfig` - View config
- `/maintenance <on|off>` - Toggle maintenance
- `/addbalance <user> <amount>` - Add balance
- `/removebalance <user> <amount>` - Remove balance
- `/userinfo <user>` - View user info
- `/database-status` - View database info
- `/transaction <id>` - View transaction
- `/refund <game-id>` - Refund game
- `/forcewithdraw <user> <amount>` - Force withdrawal
- `/giveaway` - Create giveaway

---

## 🎯 Quick Start Checklist

- [ ] Copy `.env.example` to `.env`
- [ ] Fill in `DISCORD_TOKEN`
- [ ] Fill in `DISCORD_CLIENT_ID`
- [ ] Fill in `DISCORD_GUILD_ID` (get from Discord)
- [ ] Fill in `ADMIN_ROLE_ID`
- [ ] Fill in Minecraft server details
- [ ] Enable Privileged Gateway Intents in Discord Developer Portal
- [ ] Invite bot with correct scopes and permissions
- [ ] Run `node src/index.js --register-commands`
- [ ] Verify commands appear in Discord
- [ ] Run `node src/index.js` to start bot
- [ ] Test with `/wallet` command

---

## 📝 Files Changed

1. **src/config.js** - Added `DISCORD_GUILD_ID` (optional)
2. **src/events.js** - Rewrote `registerCommands()` with guild support and validation
3. **src/index.js** - Improved startup sequence with detailed logging
4. **.env.example** - Added `DISCORD_GUILD_ID`

---

## 🔒 Security Notes

- ✅ Never commit `.env` to version control
- ✅ Bot token is never logged
- ✅ Microsoft passwords are never stored
- ✅ All monetary operations are atomic
- ✅ Transaction locking prevents double-spending
- ✅ Rate limiting prevents abuse
- ✅ Admin commands require proper permissions

---

## 📞 Support

If commands still don't appear after following all steps:

1. Check the full output of `node src/index.js --register-commands`
2. Verify all environment variables are correct
3. Check Discord Developer Portal settings
4. Look at logs in `./logs/` directory
5. Try re-inviting the bot with correct permissions

---

**Last Updated:** 2024
**Version:** 1.0.0
