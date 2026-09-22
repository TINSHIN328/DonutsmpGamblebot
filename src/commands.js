/**
 * DonutSMP Bot - Extended Commands Handler
 * Handles all new commands: balance, pay, baltop, games, help, 
 * interactive games, rewards, giveaways, etc.
 */
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  SlashCommandBuilder, PermissionFlagsBits, StringSelectMenuBuilder
} from 'discord.js';
import { v4 as uuidv4 } from 'uuid';
import config from './config.js';
import { createLogger } from './logger.js';
import * as db from './database.js';
import * as economy from './economy.js';
import * as games from './games.js';
import * as ui from './ui.js';
import { isAdmin, validateAmount, checkCommandRateLimit } from './security.js';

const log = createLogger('commands');

// Track active interactive sessions per user (Discord message context)
const activeInteractions = new Map();

// ============================================================
// COMMAND DEFINITIONS
// ============================================================

export function getExtendedCommands() {
  return [
    // Economy
    new SlashCommandBuilder()
      .setName('balance')
      .setDescription('View your wallet balance'),
    new SlashCommandBuilder()
      .setName('pay')
      .setDescription('Send money to another player')
      .addUserOption(opt => opt.setName('user').setDescription('Recipient').setRequired(true))
      .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName('baltop')
      .setDescription('View the richest players'),
    new SlashCommandBuilder()
      .setName('info')
      .setDescription('View economy information and rules'),

    // Games
    new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('Play Blackjack! Beat the dealer')
      .addIntegerOption(opt => opt.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName('slots')
      .setDescription('Play the slot machine!')
      .addIntegerOption(opt => opt.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName('chicken')
      .setDescription('Cross the road! Cash out before you get hit')
      .addIntegerOption(opt => opt.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName('keno')
      .setDescription('Pick numbers and win big!')
      .addIntegerOption(opt => opt.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1))
      .addStringOption(opt => opt.setName('numbers').setDescription('Numbers 1-40, comma separated (max 10)').setRequired(true)),
    new SlashCommandBuilder()
      .setName('limbo')
      .setDescription('Set a target multiplier and try to beat it!')
      .addIntegerOption(opt => opt.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1))
      .addNumberOption(opt => opt.setName('target').setDescription('Target multiplier (1.01-1000)').setRequired(true).setMinValue(1.01).setMaxValue(1000)),
    new SlashCommandBuilder()
      .setName('mines')
      .setDescription('Reveal tiles and avoid mines!')
      .addIntegerOption(opt => opt.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1))
      .addIntegerOption(opt => opt.setName('mines').setDescription('Number of mines (1-24)').setRequired(true).setMinValue(1).setMaxValue(24)),
    new SlashCommandBuilder()
      .setName('tower')
      .setDescription('Climb the tower floor by floor!')
      .addIntegerOption(opt => opt.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1))
      .addStringOption(opt =>
        opt.setName('difficulty')
          .setDescription('Difficulty level')
          .setRequired(false)
          .addChoices(
            { name: 'Easy (1.3x/floor)', value: 'easy' },
            { name: 'Medium (1.5x/floor)', value: 'medium' },
            { name: 'Hard (2.0x/floor)', value: 'hard' },
          )
      ),

    // Rewards
    new SlashCommandBuilder()
      .setName('redeem')
      .setDescription('Redeem a promo code')
      .addStringOption(opt => opt.setName('code').setDescription('Promo code').setRequired(true)),
    new SlashCommandBuilder()
      .setName('rakeback')
      .setDescription('View and claim your rakeback'),
    new SlashCommandBuilder()
      .setName('invites')
      .setDescription('View your referral invites'),
    new SlashCommandBuilder()
      .setName('advertisement')
      .setDescription('View advertisement reward information'),

    // Rankings
    new SlashCommandBuilder()
      .setName('games')
      .setDescription('View all available games'),

    // Fairness
    new SlashCommandBuilder()
      .setName('provablyfair')
      .setDescription('Learn about our provably fair system'),

    // Utility
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('View all available commands'),
    new SlashCommandBuilder()
      .setName('refreshroles')
      .setDescription('Synchronize your roles based on your stats'),

    // Admin
    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Create a giveaway (admin)')
      .addStringOption(opt => opt.setName('prize').setDescription('Prize description').setRequired(true))
      .addIntegerOption(opt => opt.setName('amount').setDescription('Prize amount').setRequired(true).setMinValue(0))
      .addIntegerOption(opt => opt.setName('duration').setDescription('Duration in minutes').setRequired(true).setMinValue(1))
      .addIntegerOption(opt => opt.setName('winners').setDescription('Number of winners').setRequired(false).setMinValue(1))
      .addIntegerOption(opt => opt.setName('min-wagered').setDescription('Minimum total wagered to enter').setRequired(false).setMinValue(0))
      .addIntegerOption(opt => opt.setName('min-games').setDescription('Minimum games played to enter').setRequired(false).setMinValue(0))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('forcewithdraw')
      .setDescription('Force a withdrawal for a user (admin)')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(opt => opt.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ];
}

// ============================================================
// COMMAND HANDLERS
// ============================================================

export async function handleExtendedCommand(interaction) {
  const command = interaction.commandName;

  try {
    checkCommandRateLimit(interaction.user.id, command);
  } catch (error) {
    await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    return;
  }

  // Check maintenance for gambling commands
  const maintenanceCommands = ['coinflip', 'blackjack', 'slots', 'chicken', 'keno', 'limbo', 'mines', 'tower', 'dice', 'roulette', 'highlow', 'crash', 'deposit', 'withdraw', 'pay'];
  const maintenance = db.getSetting('maintenance_mode');
  if (maintenance === 'true' && maintenanceCommands.includes(command) && !isAdmin(interaction)) {
    await interaction.reply({ content: '🔧 The bot is in maintenance mode. Gambling is temporarily disabled.', ephemeral: true });
    return;
  }

  switch (command) {
    case 'balance': await handleBalance(interaction); break;
    case 'pay': await handlePay(interaction); break;
    case 'baltop': await handleBaltop(interaction); break;
    case 'info': await handleInfo(interaction); break;
    case 'blackjack': await handleBlackjack(interaction); break;
    case 'slots': await handleSlots(interaction); break;
    case 'chicken': await handleChicken(interaction); break;
    case 'keno': await handleKeno(interaction); break;
    case 'limbo': await handleLimbo(interaction); break;
    case 'mines': await handleMines(interaction); break;
    case 'tower': await handleTower(interaction); break;
    case 'redeem': await handleRedeem(interaction); break;
    case 'rakeback': await handleRakeback(interaction); break;
    case 'invites': await handleInvites(interaction); break;
    case 'advertisement': await handleAdvertisement(interaction); break;
    case 'games': await handleGamesList(interaction); break;
    case 'provablyfair': await handleProvablyFair(interaction); break;
    case 'help': await handleHelp(interaction); break;
    case 'refreshroles': await handleRefreshRoles(interaction); break;
    case 'giveaway': await handleGiveaway(interaction); break;
    case 'forcewithdraw': await handleForceWithdraw(interaction); break;
    default: break;
  }
}

// ============================================================
// ECONOMY COMMANDS
// ============================================================

async function handleBalance(interaction) {
  await interaction.deferReply();

  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ You don\'t have an account. Use `/link` to get started.' });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('💰 Balance')
    .setColor(0x5865F2)
    .setThumbnail(interaction.user.displayAvatarURL())
    .addFields(
      { name: '💵 Wallet Balance', value: economy.formatMoney(profile.wallet.balance), inline: false },
      { name: '🎮 Minecraft', value: profile.mcAccount?.minecraft_username || 'Not linked', inline: true },
    )
    .setFooter({ text: 'Use /wallet for detailed stats' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handlePay(interaction) {
  await interaction.deferReply();

  const targetUser = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');

  if (targetUser.id === interaction.user.id) {
    await interaction.editReply({ content: '❌ You cannot pay yourself.' });
    return;
  }

  const senderProfile = db.getUserProfile(interaction.user.id);
  if (!senderProfile || !senderProfile.mcAccount) {
    await interaction.editReply({ content: '❌ You must link your account first with `/link`.' });
    return;
  }

  const recipientProfile = db.getUserProfile(targetUser.id);
  if (!recipientProfile) {
    await interaction.editReply({ content: '❌ That user hasn\'t linked their account yet.' });
    return;
  }

  if (senderProfile.wallet.balance < amount) {
    await interaction.editReply({ content: `❌ Insufficient balance. You have ${economy.formatMoney(senderProfile.wallet.balance)}.` });
    return;
  }

  try {
    const { transactionId, senderNewBalance, recipientNewBalance } = db.processPayment(
      senderProfile.user.id, recipientProfile.user.id, amount
    );

    const embed = new EmbedBuilder()
      .setTitle('💸 Payment Sent')
      .setColor(0x57F287)
      .addFields(
        { name: 'From', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'To', value: `<@${targetUser.id}>`, inline: true },
        { name: 'Amount', value: economy.formatMoney(amount), inline: true },
        { name: 'Transaction', value: `\`${transactionId.slice(0, 12)}...\``, inline: false },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleBaltop(interaction) {
  await interaction.deferReply();

  const leaderboard = db.getBalanceLeaderboard(10, 0);
  const totalUsers = db.countWalletUsers();

  if (leaderboard.length === 0) {
    await interaction.editReply({ content: '❌ No players found.' });
    return;
  }

  const lines = leaderboard.map((entry, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `${medal} <@${entry.discord_user_id}> — ${economy.formatMoney(entry.balance)}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('🏆 Balance Leaderboard')
    .setColor(0xFFD700)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${totalUsers} total players` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleInfo(interaction) {
  await interaction.deferReply();

  const embed = new EmbedBuilder()
    .setTitle('📖 Economy Information')
    .setColor(0x5865F2)
    .addFields(
      { name: '💰 Starting Balance', value: economy.formatMoney(config.STARTING_BALANCE), inline: true },
      { name: '🏛️ Game Tax', value: `${config.GAME_TAX_PERCENT}% on profit`, inline: true },
      { name: '📤 Withdraw Tax', value: `${config.WITHDRAW_TAX_PERCENT}% on amount`, inline: true },
      { name: '📊 Min Bet', value: economy.formatMoney(config.MIN_BET), inline: true },
      { name: '📊 Max Bet', value: economy.formatMoney(config.MAX_BET), inline: true },
      { name: '🎉 Big Win Threshold', value: economy.formatMoney(config.BIG_WIN_THRESHOLD), inline: true },
      { name: '⏰ Daily Wager Limit', value: economy.formatMoney(config.MAX_DAILY_WAGER), inline: true },
      { name: '🔐 Fairness', value: 'All games use provably fair HMAC-SHA256', inline: false },
      { name: '💡 Tax Example', value: 'Bet $1M → Win → Profit $1M → Tax $150K → Net $850K', inline: false },
    )
    .setFooter({ text: 'Use /help for all commands' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ============================================================
// GAME COMMANDS
// ============================================================

async function handleBlackjack(interaction) {
  await interaction.deferReply();

  const bet = interaction.options.getInteger('bet');
  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  try {
    const result = games.startBlackjack(profile.user.id, interaction.user.id, bet);

    const playerCards = result.playerHand.map(c => `${c.rank}${c.suit}`).join(' ');
    const dealerCards = result.dealerVisible.map(c => `${c.rank}${c.suit}`).join(' ') + ' 🂠';

    const embed = new EmbedBuilder()
      .setTitle('♠️ Blackjack')
      .setColor(result.isBlackjack ? 0xFFD700 : 0x5865F2)
      .addFields(
        { name: '🃏 Your Hand', value: `${playerCards}\nTotal: **${result.playerTotal}**`, inline: true },
        { name: '🎴 Dealer', value: `${dealerCards}\nShowing: **${result.dealerTotal}**`, inline: true },
        { name: '💰 Bet', value: economy.formatMoney(bet), inline: true },
      )
      .setFooter({ text: `Game ID: ${result.gameId.slice(0, 8)}` });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj_hit_${result.sessionId}`).setLabel('🃏 Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bj_stand_${result.sessionId}`).setLabel('🛑 Stand').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bj_double_${result.sessionId}`).setLabel('💰 Double').setStyle(ButtonStyle.Success),
    );

    // Store session context
    activeInteractions.set(result.sessionId, { userId: profile.user.id, discordUserId: interaction.user.id, channelId: interaction.channelId });

    if (result.isBlackjack) {
      // Auto-stand on blackjack
      const finalResult = games.blackjackStand(result.sessionId, profile.user.id);
      activeInteractions.delete(result.sessionId);
      const resultEmbed = ui.createGameResultEmbed({ ...finalResult, gameType: 'blackjack', gameData: { playerTotal: result.playerTotal, dealerTotal: 0 } });
      await interaction.editReply({ embeds: [resultEmbed] });
    } else {
      await interaction.editReply({ embeds: [embed], components: [buttons] });
    }
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleSlots(interaction) {
  await interaction.deferReply();

  const bet = interaction.options.getInteger('bet');
  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  try {
    const result = await games.playSlots(profile.user.id, interaction.user.id, bet);
    const embed = ui.createGameResultEmbed({ ...result, gameType: 'slots' });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleChicken(interaction) {
  await interaction.deferReply();

  const bet = interaction.options.getInteger('bet');
  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  try {
    const result = games.startChicken(profile.user.id, interaction.user.id, bet);

    const embed = new EmbedBuilder()
      .setTitle('🐔 Chicken Road')
      .setColor(0x5865F2)
      .addFields(
        { name: '💰 Bet', value: economy.formatMoney(bet), inline: true },
        { name: '📊 Multiplier', value: `${result.currentMultiplier}x`, inline: true },
        { name: '🛣️ Progress', value: `Row 0/${result.totalRows}`, inline: true },
      )
      .setDescription('Choose a column to cross! Avoid the chickens! 🐔');

    // Create column buttons (5 columns)
    const row = new ActionRowBuilder();
    for (let i = 0; i < result.columns; i++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`chicken_${result.sessionId}_${i}`)
          .setLabel(`${i + 1}`)
          .setStyle(ButtonStyle.Primary)
      );
    }

    const cashoutRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`chicken_cashout_${result.sessionId}`)
        .setLabel('💰 Cash Out')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    activeInteractions.set(result.sessionId, { userId: profile.user.id, discordUserId: interaction.user.id });
    await interaction.editReply({ embeds: [embed], components: [row, cashoutRow] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleKeno(interaction) {
  await interaction.deferReply();

  const bet = interaction.options.getInteger('bet');
  const numbersStr = interaction.options.getString('numbers');
  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  // Parse numbers
  const selectedNumbers = numbersStr.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));

  try {
    const result = await games.playKeno(profile.user.id, interaction.user.id, bet, selectedNumbers);
    const embed = ui.createGameResultEmbed({ ...result, gameType: 'keno' });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleLimbo(interaction) {
  await interaction.deferReply();

  const bet = interaction.options.getInteger('bet');
  const target = interaction.options.getNumber('target');
  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  try {
    const result = await games.playLimbo(profile.user.id, interaction.user.id, bet, target);
    const embed = ui.createGameResultEmbed({ ...result, gameType: 'limbo' });
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleMines(interaction) {
  await interaction.deferReply();

  const bet = interaction.options.getInteger('bet');
  const mineCount = interaction.options.getInteger('mines');
  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  try {
    const result = games.startMines(profile.user.id, interaction.user.id, bet, mineCount);

    const embed = new EmbedBuilder()
      .setTitle('💣 Mines')
      .setColor(0x5865F2)
      .addFields(
        { name: '💰 Bet', value: economy.formatMoney(bet), inline: true },
        { name: '💣 Mines', value: `${mineCount}`, inline: true },
        { name: '📊 Multiplier', value: `${result.currentMultiplier}x`, inline: true },
      )
      .setDescription(`Click tiles to reveal! ${result.safeTiles} safe tiles out of ${result.totalTiles}.`);

    // Create 5x5 grid of buttons
    const rows = [];
    for (let r = 0; r < 5; r++) {
      const row = new ActionRowBuilder();
      for (let c = 0; c < 5; c++) {
        const tileIndex = r * 5 + c;
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`mines_${result.sessionId}_${tileIndex}`)
            .setLabel('⬜')
            .setStyle(ButtonStyle.Secondary)
        );
      }
      rows.push(row);
    }

    // Cashout button
    const cashoutRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mines_cashout_${result.sessionId}`)
        .setLabel('💰 Cash Out (1.00x)')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    activeInteractions.set(result.sessionId, { userId: profile.user.id, discordUserId: interaction.user.id });
    await interaction.editReply({ embeds: [embed], components: [...rows, cashoutRow] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleTower(interaction) {
  await interaction.deferReply();

  const bet = interaction.options.getInteger('bet');
  const difficulty = interaction.options.getString('difficulty') || 'medium';
  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  try {
    const result = games.startTower(profile.user.id, interaction.user.id, bet, difficulty);

    const embed = new EmbedBuilder()
      .setTitle('🏗️ Tower')
      .setColor(0x5865F2)
      .addFields(
        { name: '💰 Bet', value: economy.formatMoney(bet), inline: true },
        { name: '📊 Difficulty', value: difficulty.charAt(0).toUpperCase() + difficulty.slice(1), inline: true },
        { name: '📈 Multiplier', value: `${result.currentMultiplier}x`, inline: true },
        { name: '🏢 Floor', value: `0/${result.totalFloors}`, inline: true },
      )
      .setDescription('Select a safe tile on each floor to climb higher!');

    // Create floor buttons
    const floorRow = new ActionRowBuilder();
    for (let i = 0; i < result.tilesPerFloor; i++) {
      floorRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`tower_${result.sessionId}_0_${i}`)
          .setLabel(`${i + 1}`)
          .setStyle(ButtonStyle.Primary)
      );
    }

    const cashoutRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tower_cashout_${result.sessionId}`)
        .setLabel('💰 Cash Out (1.00x)')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    activeInteractions.set(result.sessionId, { userId: profile.user.id, discordUserId: interaction.user.id });
    await interaction.editReply({ embeds: [embed], components: [floorRow, cashoutRow] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

// ============================================================
// REWARDS COMMANDS
// ============================================================

async function handleRedeem(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const code = interaction.options.getString('code');
  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  try {
    const { transactionId, amount, newBalance } = db.redeemPromoCode(profile.user.id, code, interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle('🎁 Code Redeemed!')
      .setColor(0x57F287)
      .addFields(
        { name: '💰 Amount', value: economy.formatMoney(amount), inline: true },
        { name: '🏦 New Balance', value: economy.formatMoney(newBalance), inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleRakeback(interaction) {
  await interaction.deferReply();

  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  const rakeback = db.getRakebackInfo(profile.user.id);
  const wagered = rakeback?.total_wagered || 0;
  const totalClaimed = rakeback?.total_rakeback || 0;
  const rakebackPercent = 0.1; // 0.1% rakeback
  const available = Math.floor(wagered * rakebackPercent / 100);

  const embed = new EmbedBuilder()
    .setTitle('💎 Rakeback')
    .setColor(0x9B59B6)
    .addFields(
      { name: '🎲 Total Wagered', value: economy.formatMoney(wagered), inline: true },
      { name: '💰 Rakeback Rate', value: `${rakebackPercent}%`, inline: true },
      { name: '💵 Available', value: economy.formatMoney(available), inline: true },
      { name: '📊 Total Claimed', value: economy.formatMoney(totalClaimed), inline: true },
    )
    .setTimestamp();

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rakeback_claim_${interaction.user.id}`)
      .setLabel('💰 Claim Rakeback')
      .setStyle(ButtonStyle.Success)
      .setDisabled(available <= 0),
  );

  await interaction.editReply({ embeds: [embed], components: [buttons] });
}

async function handleInvites(interaction) {
  await interaction.deferReply();

  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  const invites = db.getUserInvites(profile.user.id);

  const embed = new EmbedBuilder()
    .setTitle('📨 Your Invites')
    .setColor(0x3498DB)
    .setDescription(
      invites.length > 0
        ? invites.map(inv => `• <@${inv.invitee_discord}> — ${inv.eligible ? '✅ Eligible' : '⏳ Pending'}`).join('\n')
        : 'No invites yet. Share your invite link to earn rewards!'
    )
    .addFields(
      { name: '📊 Total Invites', value: `${invites.length}`, inline: true },
      { name: '✅ Eligible', value: `${invites.filter(i => i.eligible).length}`, inline: true },
    )
    .setFooter({ text: `Your invite code: ${interaction.user.id}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleAdvertisement(interaction) {
  await interaction.deferReply();

  const embed = new EmbedBuilder()
    .setTitle('📢 Advertisement Rewards')
    .setColor(0xF39C12)
    .setDescription(
      'Earn rewards by advertising DonutSMP!\n\n' +
      'Post about DonutSMP on social media, forums, or Discord servers.\n' +
      'Contact an admin with proof to receive your reward.\n\n' +
      '*This is optional and not required to play.*'
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ============================================================
// GAMES LIST & HELP
// ============================================================

async function handleGamesList(interaction) {
  await interaction.deferReply();

  const gameSettings = db.getAllGameSettings();
  const enabledGames = gameSettings.filter(g => g.enabled);

  const gameList = [
    { name: '🪙 Coinflip', desc: '2x payout', cmd: '/coinflip' },
    { name: '♠️ Blackjack', desc: 'Beat the dealer', cmd: '/blackjack' },
    { name: '🎡 Roulette', desc: '2x-36x payout', cmd: '/roulette' },
    { name: '🎰 Slots', desc: 'Match symbols', cmd: '/slots' },
    { name: '🎲 Dice', desc: '6x payout', cmd: '/dice' },
    { name: '🐔 Chicken', desc: 'Cross the road', cmd: '/chicken' },
    { name: '🎯 Keno', desc: 'Pick numbers', cmd: '/keno' },
    { name: '🚀 Limbo', desc: 'Set target multiplier', cmd: '/limbo' },
    { name: '💣 Mines', desc: 'Avoid mines', cmd: '/mines' },
    { name: '🏗️ Tower', desc: 'Climb floors', cmd: '/tower' },
  ];

  const lines = gameList.map(g => {
    const setting = gameSettings.find(s => s.game_type === g.name.split(' ')[1]?.toLowerCase() || g.cmd.slice(1));
    const status = '🟢';
    return `${status} **${g.name}** — ${g.desc}\n   \`${g.cmd}\``;
  });

  const embed = new EmbedBuilder()
    .setTitle('🎰 DonutSMP Games')
    .setColor(0x5865F2)
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: `${config.GAME_TAX_PERCENT}% tax on profits | /provablyfair for fairness info` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleProvablyFair(interaction) {
  await interaction.deferReply();

  const embed = new EmbedBuilder()
    .setTitle('🔐 Provably Fair System')
    .setColor(0x5865F2)
    .setDescription(
      'All games use a **provably fair** system based on cryptographic hashing.\n\n' +
      '**How it works:**\n' +
      '1. Before each game, a **server seed** is generated and its hash is committed\n' +
      '2. A **client seed** and **nonce** are also generated\n' +
      '3. The result is computed using HMAC-SHA256(server_seed, client_seed:nonce)\n' +
      '4. After the game, the server seed is revealed\n' +
      '5. You can verify: hash(revealed_seed) == committed_hash\n\n' +
      '**Verification:**\n' +
      'Use `/verify <game-id>` to verify any past game result.\n\n' +
      'This ensures the bot cannot change results after you place a bet.'
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleHelp(interaction) {
  await interaction.deferReply();

  const embed = new EmbedBuilder()
    .setTitle('📖 DonutSMP Bot Help')
    .setColor(0x5865F2)
    .addFields(
      {
        name: '💰 Economy',
        value: '`/balance` `/wallet` `/deposit` `/withdraw` `/pay` `/history` `/info`',
        inline: false,
      },
      {
        name: '🎰 Games',
        value: '`/coinflip` `/blackjack` `/roulette` `/slots` `/dice` `/chicken` `/keno` `/limbo` `/mines` `/tower`',
        inline: false,
      },
      {
        name: '👤 Account',
        value: '`/link` `/unlink` `/profile` `/account`',
        inline: false,
      },
      {
        name: '🏆 Rewards',
        value: '`/baltop` `/games` `/redeem` `/rakeback` `/invites` `/advertisement`',
        inline: false,
      },
      {
        name: '🔐 Fairness',
        value: '`/provablyfair` `/verify`',
        inline: false,
      },
      {
        name: '⚙️ Utility',
        value: '`/status` `/help` `/refreshroles`',
        inline: false,
      },
      {
        name: '🛡️ Admin',
        value: '`/giveaway` `/setchannel` `/setconfig` `/maintenance` `/addbalance` `/removebalance` `/database-status`',
        inline: false,
      },
    )
    .setFooter({ text: `${config.GAME_TAX_PERCENT}% tax on profits | All games provably fair` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleRefreshRoles(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ Link your account first with `/link`.' });
    return;
  }

  const guildId = interaction.guildId;
  const roleConfigs = db.getRoleSyncConfig(guildId);

  if (roleConfigs.length === 0) {
    await interaction.editReply({ content: '❌ No role sync is configured for this server.' });
    return;
  }

  const changes = [];
  const member = interaction.member;

  for (const rc of roleConfigs) {
    const role = interaction.guild.roles.cache.get(rc.role_id);
    if (!role) continue;

    let qualifies = false;
    switch (rc.requirement_type) {
      case 'balance':
        qualifies = profile.wallet.balance >= rc.requirement_value;
        break;
      case 'wagered':
        qualifies = profile.wallet.total_wagered >= rc.requirement_value;
        break;
      case 'games':
        qualifies = profile.wallet.games_played >= rc.requirement_value;
        break;
    }

    const hasRole = member.roles.cache.has(rc.role_id);
    if (qualifies && !hasRole) {
      try {
        await member.roles.add(role);
        changes.push(`✅ Added **${role.name}**`);
      } catch { /* ignore permission errors */ }
    } else if (!qualifies && hasRole) {
      try {
        await member.roles.remove(role);
        changes.push(`❌ Removed **${role.name}**`);
      } catch { /* ignore */ }
    }
  }

  if (changes.length === 0) {
    await interaction.editReply({ content: '✅ Your roles are already up to date!' });
  } else {
    await interaction.editReply({ content: `🔄 Role sync complete:\n${changes.join('\n')}` });
  }
}

// ============================================================
// ADMIN COMMANDS
// ============================================================

async function handleGiveaway(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const prize = interaction.options.getString('prize');
  const amount = interaction.options.getInteger('amount');
  const duration = interaction.options.getInteger('duration');
  const winners = interaction.options.getInteger('winners') || 1;
  const minWagered = interaction.options.getInteger('min-wagered') || 0;
  const minGames = interaction.options.getInteger('min-games') || 0;

  const giveawayId = uuidv4();
  const endsAt = new Date(Date.now() + duration * 60 * 1000).toISOString();

  try {
    db.createGiveaway(giveawayId, interaction.guildId, interaction.channelId, prize, amount, winners, minWagered, minGames, 0, endsAt, interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle('🎁 GIVEAWAY!')
      .setColor(0xFFD700)
      .setDescription(
        `**Prize:** ${prize}${amount > 0 ? ` (${economy.formatMoney(amount)})` : ''}\n` +
        `**Winners:** ${winners}\n` +
        `**Ends:** <t:${Math.floor(new Date(endsAt).getTime() / 1000)}:R>\n\n` +
        (minWagered > 0 ? `⚠️ Minimum ${economy.formatMoney(minWagered)} wagered required\n` : '') +
        (minGames > 0 ? `⚠️ Minimum ${minGames} games played required\n` : '') +
        '\nClick the button below to enter!'
      )
      .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`giveaway_enter_${giveawayId}`)
        .setLabel('🎁 Enter Giveaway')
        .setStyle(ButtonStyle.Success),
    );

    await interaction.editReply({ embeds: [embed], components: [buttons] });

    // Schedule end
    setTimeout(async () => {
      try {
        const result = db.endGiveaway(giveawayId);
        const channel = interaction.client.channels.cache.get(interaction.channelId);
        if (channel && result.winners.length > 0) {
          const winnerMentions = result.winners.map(w => `<@${w.user_id}>`).join(', ');
          await channel.send({
            content: `🎁 **Giveaway Ended!** Winners: ${winnerMentions}\nPrize: ${prize}${amount > 0 ? ` (${economy.formatMoney(result.amountPerWinner)} each)` : ''}`,
          });
        } else if (channel) {
          await channel.send({ content: '🎁 **Giveaway Ended!** No eligible entries.' });
        }
      } catch (error) {
        log.error({ error: error.message }, 'Failed to end giveaway');
      }
    }, duration * 60 * 1000);
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleForceWithdraw(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');

  const profile = db.getUserProfile(targetUser.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ User not found.' });
    return;
  }

  try {
    const { withdrawalId, taxAmount, netAmount } = db.processWithdrawal(profile.user.id, amount);

    await interaction.editReply({
      content: `✅ Withdrawal created for <@${targetUser.id}>: ${economy.formatMoney(amount)} (net: ${economy.formatMoney(netAmount)}, tax: ${economy.formatMoney(taxAmount)}). ID: \`${withdrawalId.slice(0, 12)}\``,
    });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

// ============================================================
// BUTTON HANDLER FOR INTERACTIVE GAMES
// ============================================================

export async function handleGameButton(interaction) {
  const customId = interaction.customId;

  // Blackjack buttons
  if (customId.startsWith('bj_hit_')) {
    const sessionId = customId.replace('bj_hit_', '');
    const ctx = activeInteractions.get(sessionId);
    if (!ctx || ctx.discordUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ This is not your game.', ephemeral: true });
      return;
    }

    try {
      const result = games.blackjackHit(sessionId, ctx.userId);
      const playerCards = result.playerHand.map(c => `${c.rank}${c.suit}`).join(' ');
      const dealerCards = result.dealerVisible.map(c => `${c.rank}${c.suit}`).join(' ') + ' 🂠';

      const embed = new EmbedBuilder()
        .setTitle('♠️ Blackjack')
        .setColor(result.bust ? 0xED4245 : result.blackjack ? 0xFFD700 : 0x5865F2)
        .addFields(
          { name: '🃏 Your Hand', value: `${playerCards}\nTotal: **${result.playerTotal}**`, inline: true },
          { name: '🎴 Dealer', value: `${dealerCards}`, inline: true },
        );

      if (result.bust) {
        // Auto-stand on bust
        const finalResult = games.blackjackStand(sessionId, ctx.userId);
        activeInteractions.delete(sessionId);
        const resultEmbed = ui.createGameResultEmbed({ ...finalResult, gameType: 'blackjack' });
        await interaction.update({ embeds: [resultEmbed], components: [] });
      } else if (result.blackjack) {
        const finalResult = games.blackjackStand(sessionId, ctx.userId);
        activeInteractions.delete(sessionId);
        const resultEmbed = ui.createGameResultEmbed({ ...finalResult, gameType: 'blackjack' });
        await interaction.update({ embeds: [resultEmbed], components: [] });
      } else {
        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`bj_hit_${sessionId}`).setLabel('🃏 Hit').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`bj_stand_${sessionId}`).setLabel('🛑 Stand').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`bj_double_${sessionId}`).setLabel('💰 Double').setStyle(ButtonStyle.Success).setDisabled(true),
        );
        await interaction.update({ embeds: [embed], components: [buttons] });
      }
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }

  if (customId.startsWith('bj_stand_')) {
    const sessionId = customId.replace('bj_stand_', '');
    const ctx = activeInteractions.get(sessionId);
    if (!ctx || ctx.discordUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ This is not your game.', ephemeral: true });
      return;
    }

    try {
      const result = games.blackjackStand(sessionId, ctx.userId);
      activeInteractions.delete(sessionId);
      const resultEmbed = ui.createGameResultEmbed({ ...result, gameType: 'blackjack' });
      await interaction.update({ embeds: [resultEmbed], components: [] });
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }

  if (customId.startsWith('bj_double_')) {
    const sessionId = customId.replace('bj_double_', '');
    const ctx = activeInteractions.get(sessionId);
    if (!ctx || ctx.discordUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ This is not your game.', ephemeral: true });
      return;
    }

    try {
      const result = games.blackjackDouble(sessionId, ctx.userId);
      if (result.mustStand || result.bust) {
        const finalResult = games.blackjackStand(sessionId, ctx.userId);
        activeInteractions.delete(sessionId);
        const resultEmbed = ui.createGameResultEmbed({ ...finalResult, gameType: 'blackjack' });
        await interaction.update({ embeds: [resultEmbed], components: [] });
      }
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }

  // Mines buttons
  if (customId.startsWith('mines_') && !customId.includes('cashout')) {
    const parts = customId.split('_');
    const sessionId = parts[1];
    const tileIndex = parseInt(parts[2]);
    const ctx = activeInteractions.get(sessionId);
    if (!ctx || ctx.discordUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ This is not your game.', ephemeral: true });
      return;
    }

    try {
      const result = games.minesReveal(sessionId, ctx.userId, tileIndex);

      if (result.hit) {
        // Hit a mine
        const finalResult = games.minesHitMine(sessionId, ctx.userId);
        activeInteractions.delete(sessionId);
        const resultEmbed = ui.createGameResultEmbed({ ...finalResult, gameType: 'mines' });
        await interaction.update({ embeds: [resultEmbed], components: [] });
      } else {
        // Safe tile
        const session = db.getSession(sessionId);
        const data = JSON.parse(session.session_data);

        const embed = new EmbedBuilder()
          .setTitle('💣 Mines')
          .setColor(0x57F287)
          .addFields(
            { name: '📊 Multiplier', value: `${result.currentMultiplier}x`, inline: true },
            { name: '💰 Potential', value: economy.formatMoney(Math.floor(session.bet_amount * result.currentMultiplier)), inline: true },
            { name: '🔓 Revealed', value: `${result.revealedCount}`, inline: true },
          );

        // Rebuild grid
        const rows = [];
        for (let r = 0; r < 5; r++) {
          const row = new ActionRowBuilder();
          for (let c = 0; c < 5; c++) {
            const idx = r * 5 + c;
            const isRevealed = data.revealedTiles.includes(idx);
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(isRevealed ? `mines_revealed_${idx}` : `mines_${sessionId}_${idx}`)
                .setLabel(isRevealed ? '💎' : '⬜')
                .setStyle(isRevealed ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(isRevealed)
            );
          }
          rows.push(row);
        }

        const cashoutRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`mines_cashout_${sessionId}`)
            .setLabel(`💰 Cash Out (${result.currentMultiplier}x)`)
            .setStyle(ButtonStyle.Success),
        );

        await interaction.update({ embeds: [embed], components: [...rows, cashoutRow] });
      }
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }

  if (customId.startsWith('mines_cashout_')) {
    const sessionId = customId.replace('mines_cashout_', '');
    const ctx = activeInteractions.get(sessionId);
    if (!ctx || ctx.discordUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ This is not your game.', ephemeral: true });
      return;
    }

    try {
      const result = games.minesCashout(sessionId, ctx.userId);
      activeInteractions.delete(sessionId);
      const resultEmbed = ui.createGameResultEmbed({ ...result, gameType: 'mines' });
      await interaction.update({ embeds: [resultEmbed], components: [] });
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }

  // Tower buttons
  if (customId.startsWith('tower_') && !customId.includes('cashout')) {
    const parts = customId.split('_');
    const sessionId = parts[1];
    const floor = parseInt(parts[2]);
    const tileIndex = parseInt(parts[3]);
    const ctx = activeInteractions.get(sessionId);
    if (!ctx || ctx.discordUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ This is not your game.', ephemeral: true });
      return;
    }

    try {
      const result = games.towerSelect(sessionId, ctx.userId, floor, tileIndex);

      if (!result.safe) {
        const finalResult = games.towerHitMine(sessionId, ctx.userId);
        activeInteractions.delete(sessionId);
        const resultEmbed = ui.createGameResultEmbed({ ...finalResult, gameType: 'tower' });
        await interaction.update({ embeds: [resultEmbed], components: [] });
      } else {
        const session = db.getSession(sessionId);
        const data = JSON.parse(session.session_data);

        const embed = new EmbedBuilder()
          .setTitle('🏗️ Tower')
          .setColor(0x57F287)
          .addFields(
            { name: '📊 Multiplier', value: `${result.currentMultiplier}x`, inline: true },
            { name: '🏢 Floor', value: `${result.currentFloor}/${data.totalFloors}`, inline: true },
          );

        const floorRow = new ActionRowBuilder();
        for (let i = 0; i < data.tilesPerFloor; i++) {
          floorRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`tower_${sessionId}_${result.currentFloor}_${i}`)
              .setLabel(`${i + 1}`)
              .setStyle(ButtonStyle.Primary)
          );
        }

        const cashoutRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`tower_cashout_${sessionId}`)
            .setLabel(`💰 Cash Out (${result.currentMultiplier}x)`)
            .setStyle(ButtonStyle.Success),
        );

        await interaction.update({ embeds: [embed], components: [floorRow, cashoutRow] });
      }
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }

  if (customId.startsWith('tower_cashout_')) {
    const sessionId = customId.replace('tower_cashout_', '');
    const ctx = activeInteractions.get(sessionId);
    if (!ctx || ctx.discordUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ This is not your game.', ephemeral: true });
      return;
    }

    try {
      const result = games.towerCashout(sessionId, ctx.userId);
      activeInteractions.delete(sessionId);
      const resultEmbed = ui.createGameResultEmbed({ ...result, gameType: 'tower' });
      await interaction.update({ embeds: [resultEmbed], components: [] });
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }

  // Chicken buttons
  if (customId.startsWith('chicken_') && !customId.includes('cashout')) {
    const parts = customId.split('_');
    const sessionId = parts[1];
    const column = parseInt(parts[2]);
    const ctx = activeInteractions.get(sessionId);
    if (!ctx || ctx.discordUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ This is not your game.', ephemeral: true });
      return;
    }

    try {
      const result = games.chickenCross(sessionId, ctx.userId, column);

      if (!result.safe) {
        const finalResult = games.chickenHit(sessionId, ctx.userId);
        activeInteractions.delete(sessionId);
        const resultEmbed = ui.createGameResultEmbed({ ...finalResult, gameType: 'chicken' });
        await interaction.update({ embeds: [resultEmbed], components: [] });
      } else {
        const session = db.getSession(sessionId);
        const data = JSON.parse(session.session_data);

        const embed = new EmbedBuilder()
          .setTitle('🐔 Chicken Road')
          .setColor(0x57F287)
          .addFields(
            { name: '📊 Multiplier', value: `${result.currentMultiplier}x`, inline: true },
            { name: '🛣️ Row', value: `${result.currentRow}/${data.totalRows}`, inline: true },
          );

        const row = new ActionRowBuilder();
        for (let i = 0; i < data.columns; i++) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`chicken_${sessionId}_${i}`)
              .setLabel(`${i + 1}`)
              .setStyle(ButtonStyle.Primary)
          );
        }

        const cashoutRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`chicken_cashout_${sessionId}`)
            .setLabel(`💰 Cash Out (${result.currentMultiplier}x)`)
            .setStyle(ButtonStyle.Success),
        );

        await interaction.update({ embeds: [embed], components: [row, cashoutRow] });
      }
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }

  if (customId.startsWith('chicken_cashout_')) {
    const sessionId = customId.replace('chicken_cashout_', '');
    const ctx = activeInteractions.get(sessionId);
    if (!ctx || ctx.discordUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ This is not your game.', ephemeral: true });
      return;
    }

    try {
      const result = games.chickenCashout(sessionId, ctx.userId);
      activeInteractions.delete(sessionId);
      const resultEmbed = ui.createGameResultEmbed({ ...result, gameType: 'chicken' });
      await interaction.update({ embeds: [resultEmbed], components: [] });
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }

  // Rakeback claim button
  if (customId.startsWith('rakeback_claim_')) {
    const discordUserId = customId.replace('rakeback_claim_', '');
    if (discordUserId !== interaction.user.id) {
      await interaction.reply({ content: '❌ This is not your rakeback.', ephemeral: true });
      return;
    }

    const profile = db.getUserProfile(interaction.user.id);
    if (!profile) {
      await interaction.reply({ content: '❌ Account not found.', ephemeral: true });
      return;
    }

    try {
      const { amount, newBalance } = db.claimRakeback(profile.user.id, 0.1);
      await interaction.reply({
        content: `✅ Claimed ${economy.formatMoney(amount)} rakeback! New balance: ${economy.formatMoney(newBalance)}`,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }

  // Giveaway enter button
  if (customId.startsWith('giveaway_enter_')) {
    const giveawayId = customId.replace('giveaway_enter_', '');
    const profile = db.getUserProfile(interaction.user.id);
    if (!profile) {
      await interaction.reply({ content: '❌ Link your account first with `/link`.', ephemeral: true });
      return;
    }

    try {
      db.enterGiveaway(giveawayId, profile.user.id);
      await interaction.reply({ content: '✅ You\'ve entered the giveaway!', ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    }
  }
}
