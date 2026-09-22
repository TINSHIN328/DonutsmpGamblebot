/**
 * DonutSMP Bot - Discord Events & Command Handler
 * Registers all slash commands and handles interactions.
 */
import {
  Client, GatewayIntentBits, Events, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, ChannelType
} from 'discord.js';
import config from './config.js';
import { createLogger, logSecurityEvent } from './logger.js';
import * as db from './database.js';
import * as economy from './economy.js';
import * as gambling from './gambling.js';
import * as auth from './auth.js';
import * as minecraft from './minecraft.js';
import * as ui from './ui.js';
import { isAdmin, validateAmount, checkCommandRateLimit, checkWithdrawCooldown, updateWithdrawTracking, checkDailyWithdrawal } from './security.js';
import { getExtendedCommands, handleExtendedCommand, handleGameButton } from './commands.js';

const log = createLogger('events');

let client = null;

/**
 * Get a channel by ID.
 */
export function getChannel(channelId) {
  if (!client) return null;
  return client.channels.cache.get(channelId);
}

/**
 * Define all slash commands.
 */
function getCommandDefinitions() {
  // Combine base commands with extended commands
  const baseCommands = [
    // === Account Commands ===
    new SlashCommandBuilder()
      .setName('link')
      .setDescription('Link your Discord account to your Minecraft account'),
    new SlashCommandBuilder()
      .setName('unlink')
      .setDescription('Unlink your Minecraft account'),
    new SlashCommandBuilder()
      .setName('profile')
      .setDescription('View your player profile'),
    new SlashCommandBuilder()
      .setName('account')
      .setDescription('View your account info'),

    // === Economy Commands ===
    new SlashCommandBuilder()
      .setName('wallet')
      .setDescription('View your wallet balance and stats'),
    new SlashCommandBuilder()
      .setName('deposit')
      .setDescription('Deposit DonutSMP money into your gambling wallet')
      .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to deposit').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName('withdraw')
      .setDescription('Withdraw money from your gambling wallet to Minecraft')
      .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to withdraw').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName('history')
      .setDescription('View your transaction history')
      .addStringOption(opt =>
        opt.setName('type')
          .setDescription('Type of history')
          .setRequired(false)
          .addChoices(
            { name: 'Transactions', value: 'transactions' },
            { name: 'Games', value: 'games' },
          )
      ),

    // === Gambling Commands ===
    new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Flip a coin! 2x payout, 15% tax on profit')
      .addIntegerOption(opt => opt.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName('dice')
      .setDescription('Roll a dice! 6x payout, 15% tax on profit')
      .addIntegerOption(opt => opt.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1))
      .addIntegerOption(opt => opt.setName('number').setDescription('Pick a number (1-6)').setRequired(true).setMinValue(1).setMaxValue(6)),
    new SlashCommandBuilder()
      .setName('roulette')
      .setDescription('Play roulette! Various payouts')
      .addIntegerOption(opt => opt.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1))
      .addStringOption(opt =>
        opt.setName('bet')
          .setDescription('What to bet on')
          .setRequired(true)
          .addChoices(
            { name: 'Red (2x)', value: 'red' },
            { name: 'Black (2x)', value: 'black' },
            { name: 'Green (14x)', value: 'green' },
            { name: 'Odd (2x)', value: 'odd' },
            { name: 'Even (2x)', value: 'even' },
          )
      )
      .addIntegerOption(opt => opt.setName('number').setDescription('Number (0-36) for straight bet (36x)').setRequired(false).setMinValue(0).setMaxValue(36)),
    new SlashCommandBuilder()
      .setName('highlow')
      .setDescription('Guess high or low! 2x payout')
      .addIntegerOption(opt => opt.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1))
      .addStringOption(opt =>
        opt.setName('choice')
          .setDescription('Your guess')
          .setRequired(true)
          .addChoices(
            { name: 'High (>50)', value: 'HIGH' },
            { name: 'Low (<50)', value: 'LOW' },
            { name: 'Seven (10x)', value: 'SEVEN' },
          )
      ),
    new SlashCommandBuilder()
      .setName('crash')
      .setDescription('Crash game! Set your cashout multiplier')
      .addIntegerOption(opt => opt.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1))
      .addNumberOption(opt => opt.setName('cashout').setDescription('Cashout multiplier (1.01-100)').setRequired(true).setMinValue(1.01).setMaxValue(100)),
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Verify a game result (provably fair)')
      .addStringOption(opt => opt.setName('game_id').setDescription('Game ID to verify').setRequired(true)),

    // === Info Commands ===
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('View bot status'),

    // === Admin Commands ===
    new SlashCommandBuilder()
      .setName('setchannel')
      .setDescription('Set a channel for win announcements or logs')
      .addStringOption(opt =>
        opt.setName('type')
          .setDescription('Channel type')
          .setRequired(true)
          .addChoices(
            { name: 'Big Win Announcements', value: 'win' },
            { name: 'Audit Logs', value: 'logs' },
          )
      )
      .addChannelOption(opt => opt.setName('channel').setDescription('The channel').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('setconfig')
      .setDescription('Update a bot configuration value')
      .addStringOption(opt => opt.setName('key').setDescription('Setting key').setRequired(true))
      .addStringOption(opt => opt.setName('value').setDescription('New value').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('getconfig')
      .setDescription('View current bot configuration')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('addbalance')
      .setDescription('Add balance to a user (admin)')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to add').setRequired(true).setMinValue(1))
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for adjustment').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('removebalance')
      .setDescription('Remove balance from a user (admin)')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to remove').setRequired(true).setMinValue(1))
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for adjustment').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('View detailed user info (admin)')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('maintenance')
      .setDescription('Toggle maintenance mode')
      .addStringOption(opt =>
        opt.setName('mode')
          .setDescription('Maintenance mode')
          .setRequired(true)
          .addChoices(
            { name: 'On', value: 'on' },
            { name: 'Off', value: 'off' },
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('database-status')
      .setDescription('View database status')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('refund')
      .setDescription('Refund a game to a user (admin)')
      .addStringOption(opt => opt.setName('game_id').setDescription('Game ID to refund').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('transaction')
      .setDescription('View a specific transaction (admin)')
      .addStringOption(opt => opt.setName('transaction_id').setDescription('Transaction ID').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ];

  // Combine with extended commands
  const extendedCommands = getExtendedCommands();
  return [...baseCommands, ...extendedCommands];
}

/**
 * Initialize Discord client and register event handlers.
 */
export function initDiscordClient() {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    log.info({ user: readyClient.user.tag }, 'Discord bot ready');
    startStatusRotation(readyClient);
  });

  client.on(Events.InteractionCreate, handleInteraction);

  return client;
}

/**
 * Register slash commands with Discord API.
 */
export async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const commands = getCommandDefinitions().map(cmd => cmd.toJSON());

  try {
    log.info('Registering slash commands...');
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body: commands });
    log.info({ count: commands.length }, 'Commands registered successfully');
  } catch (error) {
    log.error({ error: error.message }, 'Failed to register commands');
    throw error;
  }
}

/**
 * Handle all interactions.
 */
async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    log.error({ error: error.message, command: interaction.commandName }, 'Interaction error');
    await sendError(interaction, error);
  }
}

/**
 * Handle slash commands.
 */
async function handleCommand(interaction) {
  // Rate limit check
  try {
    checkCommandRateLimit(interaction.user.id, interaction.commandName);
  } catch (error) {
    await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
    return;
  }

  const command = interaction.commandName;

  // Check maintenance mode for gambling/deposit/withdraw commands
  const maintenanceCommands = ['coinflip', 'dice', 'roulette', 'highlow', 'crash', 'deposit', 'withdraw'];
  const maintenance = db.getSetting('maintenance_mode');
  if (maintenance === 'true' && maintenanceCommands.includes(command) && !isAdmin(interaction)) {
    await interaction.reply({ content: '🔧 The bot is currently in maintenance mode. Gambling and transactions are temporarily disabled.', ephemeral: true });
    return;
  }

  switch (command) {
    // === Account ===
    case 'link': await handleLink(interaction); break;
    case 'unlink': await handleUnlink(interaction); break;
    case 'profile': await handleProfile(interaction); break;
    case 'account': await handleProfile(interaction); break;

    // === Economy ===
    case 'wallet': await handleWallet(interaction); break;
    case 'deposit': await handleDeposit(interaction); break;
    case 'withdraw': await handleWithdraw(interaction); break;
    case 'history': await handleHistory(interaction); break;

    // === Gambling ===
    case 'coinflip': await handleCoinflip(interaction); break;
    case 'dice': await handleDice(interaction); break;
    case 'roulette': await handleRoulette(interaction); break;
    case 'highlow': await handleHighLow(interaction); break;
    case 'crash': await handleCrash(interaction); break;
    case 'verify': await handleVerify(interaction); break;

    // === Info ===
    case 'status': await handleStatus(interaction); break;

    // === Admin ===
    case 'setchannel': await handleSetChannel(interaction); break;
    case 'setconfig': await handleSetConfig(interaction); break;
    case 'getconfig': await handleGetConfig(interaction); break;
    case 'addbalance': await handleAddBalance(interaction); break;
    case 'removebalance': await handleRemoveBalance(interaction); break;
    case 'userinfo': await handleUserInfo(interaction); break;
    case 'maintenance': await handleMaintenance(interaction); break;
    case 'database-status': await handleDatabaseStatus(interaction); break;
    case 'refund': await handleRefund(interaction); break;
    case 'transaction': await handleTransaction(interaction); break;

    // Extended commands (delegated to commands.js)
    case 'balance':
    case 'pay':
    case 'baltop':
    case 'info':
    case 'blackjack':
    case 'slots':
    case 'chicken':
    case 'keno':
    case 'limbo':
    case 'mines':
    case 'tower':
    case 'redeem':
    case 'rakeback':
    case 'invites':
    case 'advertisement':
    case 'games':
    case 'provablyfair':
    case 'help':
    case 'refreshroles':
    case 'giveaway':
    case 'forcewithdraw':
      await handleExtendedCommand(interaction);
      break;

    default:
      await interaction.reply({ content: '❓ Unknown command.', ephemeral: true });
  }
}

// ============================================================
// COMMAND HANDLERS
// ============================================================

async function handleLink(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const { code, existing } = auth.createLinkRequest(interaction.user.id);

    if (existing) {
      await interaction.editReply({
        content: `⏳ You already have a pending link request.\nCode: \`${code}\`\nPlease wait for an admin to verify your Minecraft account, or wait for the code to expire.`,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🔗 Account Linking')
      .setColor(0x5865F2)
      .setDescription(
        `To link your Minecraft account, an administrator needs to verify your identity.\n\n` +
        `**Your Link Code:** \`${code}\`\n\n` +
        `Please share this code with an administrator along with your Minecraft username.\n\n` +
        `⚠️ This code expires in 5 minutes.`
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    if (error.message.includes('ALREADY_LINKED')) {
      await interaction.editReply({ content: `❌ ${error.message}` });
    } else {
      throw error;
    }
  }
}

async function handleUnlink(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const mcAccount = auth.unlinkAccount(interaction.user.id);
    await interaction.editReply({
      content: `✅ Successfully unlinked Minecraft account **${mcAccount.minecraft_username}**.\nYour wallet balance has been preserved.`,
    });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleProfile(interaction) {
  await interaction.deferReply();

  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ You don\'t have an account yet. Use `/link` to get started.' });
    return;
  }

  const embed = ui.createProfileEmbed(profile.user, profile.wallet, profile.mcAccount, interaction.user);
  await interaction.editReply({ embeds: [embed] });
}

async function handleWallet(interaction) {
  await interaction.deferReply();

  const profile = db.getUserProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply({ content: '❌ You don\'t have an account yet. Use `/link` to get started.' });
    return;
  }

  const embed = ui.createWalletEmbed(profile.wallet, interaction.user, profile.mcAccount);
  await interaction.editReply({ embeds: [embed] });
}

async function handleDeposit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const amount = interaction.options.getInteger('amount');
  validateAmount(amount);

  const user = db.getUserByDiscordId(interaction.user.id);
  if (!user) {
    await interaction.editReply({ content: '❌ Please link your account first with `/link`.' });
    return;
  }

  const mcAccount = db.getMinecraftAccount(user.id);
  if (!mcAccount) {
    await interaction.editReply({ content: '❌ Please link your Minecraft account first with `/link`.' });
    return;
  }

  const { depositId } = db.processDeposit(user.id, amount);

  const embed = new EmbedBuilder()
    .setTitle('📥 Deposit Created')
    .setColor(0x3498DB)
    .setDescription(
      `Your deposit of **${economy.formatMoney(amount)}** has been created.\n\n` +
      `**Deposit ID:** \`${depositId.slice(0, 12)}...\`\n` +
      `**Status:** ⏳ PENDING\n\n` +
      `To complete this deposit, please transfer **${economy.formatMoney(amount)}** in-game to the bot's account.\n` +
      `The deposit will be confirmed once the in-game transaction is verified.\n\n` +
      `⚠️ This deposit expires in 30 minutes.`
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleWithdraw(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const amount = interaction.options.getInteger('amount');
  validateAmount(amount);

  // Check cooldown
  try {
    checkWithdrawCooldown(interaction.user.id);
    checkDailyWithdrawal(interaction.user.id, amount);
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
    return;
  }

  const user = db.getUserByDiscordId(interaction.user.id);
  if (!user) {
    await interaction.editReply({ content: '❌ Please link your account first with `/link`.' });
    return;
  }

  const mcAccount = db.getMinecraftAccount(user.id);
  if (!mcAccount) {
    await interaction.editReply({ content: '❌ Please link your Minecraft account first with `/link`.' });
    return;
  }

  const wallet = db.getOrCreateWallet(user.id);
  if (wallet.balance < amount) {
    await interaction.editReply({
      content: `❌ Insufficient balance. You have ${economy.formatMoney(wallet.balance)} but tried to withdraw ${economy.formatMoney(amount)}.`,
    });
    return;
  }

  try {
    const { withdrawalId, taxAmount, netAmount } = db.processWithdrawal(user.id, amount);

    // Try to execute MC payment
    try {
      if (minecraft.isBotConnected()) {
        await minecraft.executeMinecraftPayment(mcAccount.minecraft_username, netAmount, withdrawalId);
        db.confirmWithdrawal(withdrawalId);
        updateWithdrawTracking(interaction.user.id, amount);

        const embed = new EmbedBuilder()
          .setTitle('📤 Withdrawal Completed')
          .setColor(0x57F287)
          .addFields(
            { name: '💰 Amount', value: economy.formatMoney(amount), inline: true },
            { name: `🏛️ Tax (${config.WITHDRAW_TAX_PERCENT}%)`, value: economy.formatMoney(taxAmount), inline: true },
            { name: '💵 Net Received', value: economy.formatMoney(netAmount), inline: true },
            { name: '🎮 Sent to', value: mcAccount.minecraft_username, inline: true },
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        // MC bot offline - withdrawal stays PROCESSING
        const embed = new EmbedBuilder()
          .setTitle('📤 Withdrawal Pending')
          .setColor(0xFEE75C)
          .setDescription(
            `Your withdrawal of **${economy.formatMoney(amount)}** has been reserved.\n\n` +
            `**Withdrawal ID:** \`${withdrawalId.slice(0, 12)}...\`\n` +
            `**Status:** ⏳ PROCESSING\n\n` +
            `The Minecraft bot is currently offline. Your withdrawal will be processed when the bot reconnects.\n` +
            `If it is not processed within 10 minutes, the funds will be automatically refunded.`
          )
          .addFields(
            { name: '💰 Amount', value: economy.formatMoney(amount), inline: true },
            { name: `🏛️ Tax (${config.WITHDRAW_TAX_PERCENT}%)`, value: economy.formatMoney(taxAmount), inline: true },
            { name: '💵 Net Amount', value: economy.formatMoney(netAmount), inline: true },
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (mcError) {
      // MC payment failed - rollback
      db.rollbackWithdrawal(withdrawalId, mcError.message);

      await interaction.editReply({
        content: `❌ Withdrawal failed: ${mcError.message}\nYour funds have been returned to your wallet.`,
      });
    }
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleHistory(interaction) {
  await interaction.deferReply();

  const user = db.getUserByDiscordId(interaction.user.id);
  if (!user) {
    await interaction.editReply({ content: '❌ Please link your account first with `/link`.' });
    return;
  }

  const type = interaction.options.getString('type') || 'transactions';

  if (type === 'games') {
    const games = db.getGameHistory(user.id, 10, 0);
    const total = db.countGames(user.id);
    const totalPages = Math.max(1, Math.ceil(total / 10));
    const embed = ui.createGameHistoryEmbed(games, 0, totalPages);
    await interaction.editReply({ embeds: [embed] });
  } else {
    const transactions = db.getTransactionHistory(user.id, 10, 0);
    const total = db.countTransactions(user.id);
    const totalPages = Math.max(1, Math.ceil(total / 10));
    const embed = ui.createHistoryEmbed(transactions, 0, totalPages);
    await interaction.editReply({ embeds: [embed] });
  }
}

async function handleCoinflip(interaction) {
  await interaction.deferReply();

  const amount = interaction.options.getInteger('amount');
  const user = db.getUserByDiscordId(interaction.user.id);
  if (!user) {
    await interaction.editReply({ content: '❌ Please link your account first with `/link`.' });
    return;
  }

  // Random choice for the user
  const choice = Math.random() < 0.5 ? 'HEADS' : 'TAILS';

  try {
    const result = await gambling.playCoinflip(user.id, interaction.user.id, amount, choice);
    const embed = ui.createGameResultEmbed(result);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleDice(interaction) {
  await interaction.deferReply();

  const amount = interaction.options.getInteger('amount');
  const number = interaction.options.getInteger('number');
  const user = db.getUserByDiscordId(interaction.user.id);
  if (!user) {
    await interaction.editReply({ content: '❌ Please link your account first with `/link`.' });
    return;
  }

  try {
    const result = await gambling.playDice(user.id, interaction.user.id, amount, number);
    const embed = ui.createGameResultEmbed(result);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleRoulette(interaction) {
  await interaction.deferReply();

  const amount = interaction.options.getInteger('amount');
  const betType = interaction.options.getString('bet');
  const number = interaction.options.getInteger('number');
  const user = db.getUserByDiscordId(interaction.user.id);
  if (!user) {
    await interaction.editReply({ content: '❌ Please link your account first with `/link`.' });
    return;
  }

  const betValue = betType === 'number' ? (number ?? 0) : null;

  try {
    const result = await gambling.playRoulette(user.id, interaction.user.id, amount, betType, betValue);
    const embed = ui.createGameResultEmbed(result);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleHighLow(interaction) {
  await interaction.deferReply();

  const amount = interaction.options.getInteger('amount');
  const choice = interaction.options.getString('choice');
  const user = db.getUserByDiscordId(interaction.user.id);
  if (!user) {
    await interaction.editReply({ content: '❌ Please link your account first with `/link`.' });
    return;
  }

  try {
    const result = await gambling.playHighLow(user.id, interaction.user.id, amount, choice);
    const embed = ui.createGameResultEmbed(result);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleCrash(interaction) {
  await interaction.deferReply();

  const amount = interaction.options.getInteger('amount');
  const cashout = interaction.options.getNumber('cashout');
  const user = db.getUserByDiscordId(interaction.user.id);
  if (!user) {
    await interaction.editReply({ content: '❌ Please link your account first with `/link`.' });
    return;
  }

  try {
    const result = await gambling.playCrash(user.id, interaction.user.id, amount, cashout);
    const embed = ui.createGameResultEmbed(result);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleVerify(interaction) {
  await interaction.deferReply();

  const gameIdInput = interaction.options.getString('game_id');

  try {
    // Try to find the game by partial ID
    const database = db.getDb();
    const game = database.prepare('SELECT * FROM games WHERE game_id LIKE ?').get(`${gameIdInput}%`);
    if (!game) {
      await interaction.editReply({ content: '❌ Game not found. Make sure you entered the correct Game ID.' });
      return;
    }

    const verification = gambling.verifyGame(game.game_id);

    const embed = new EmbedBuilder()
      .setTitle('🔐 Game Verification')
      .setColor(verification.verified ? 0x57F287 : 0xED4245)
      .addFields(
        { name: 'Game ID', value: `\`${verification.gameId}\``, inline: false },
        { name: 'Game Type', value: verification.gameType, inline: true },
        { name: 'Hash Valid', value: verification.hashValid ? '✅ Yes' : '❌ No', inline: true },
        { name: 'Server Seed', value: `\`${verification.serverSeed.slice(0, 16)}...\``, inline: true },
        { name: 'Client Seed', value: `\`${verification.clientSeed.slice(0, 16)}...\``, inline: true },
        { name: 'Nonce', value: `${verification.nonce}`, inline: true },
        { name: 'Computed Result', value: `${verification.result}`, inline: true },
        { name: 'Verified', value: verification.verified ? '✅ Result is authentic' : '❌ Verification failed', inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleStatus(interaction) {
  await interaction.deferReply();

  const statusData = {
    discord: client?.isReady() || false,
    minecraft: minecraft.getBotStatus(),
    database: db.getDatabaseStatus(),
    version: '1.0.0',
  };

  const embed = ui.createStatusEmbed(statusData);
  await interaction.editReply({ embeds: [embed] });
}

// === Admin Handlers ===

async function handleSetChannel(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission to use this command.', ephemeral: true });
    return;
  }

  const type = interaction.options.getString('type');
  const channel = interaction.options.getChannel('channel');

  const settingKey = type === 'win' ? 'win_channel_id' : 'logs_channel_id';
  db.setSetting(settingKey, channel.id);

  await interaction.reply({
    content: `✅ ${type === 'win' ? 'Big win announcements' : 'Audit logs'} will now be sent to <#${channel.id}>.`,
    ephemeral: true,
  });
}

async function handleSetConfig(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
    return;
  }

  const key = interaction.options.getString('key');
  const value = interaction.options.getString('value');

  db.setSetting(key, value);

  db.recordAuditLog('ADMIN_ADJUSTMENT', interaction.user.id, null, null, null, 'SUCCESS',
    JSON.stringify({ action: 'SET_CONFIG', key, value }));

  await interaction.reply({ content: `✅ Setting \`${key}\` updated to \`${value}\`.`, ephemeral: true });
}

async function handleGetConfig(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
    return;
  }

  const database = db.getDb();
  const settings = database.prepare('SELECT * FROM bot_settings').all();

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Bot Configuration')
    .setColor(0x5865F2);

  const fields = settings.map(s => ({
    name: s.key,
    value: s.value || '(empty)',
    inline: true,
  }));

  // Add economy config
  fields.push(
    { name: 'GAME_TAX_PERCENT', value: `${config.GAME_TAX_PERCENT}%`, inline: true },
    { name: 'WITHDRAW_TAX_PERCENT', value: `${config.WITHDRAW_TAX_PERCENT}%`, inline: true },
    { name: 'MIN_BET', value: economy.formatMoney(config.MIN_BET), inline: true },
    { name: 'MAX_BET', value: economy.formatMoney(config.MAX_BET), inline: true },
    { name: 'BIG_WIN_THRESHOLD', value: economy.formatMoney(config.BIG_WIN_THRESHOLD), inline: true },
  );

  embed.addFields(fields.slice(0, 25)); // Discord limit
  embed.setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleAddBalance(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const reason = interaction.options.getString('reason');

  const user = db.getUserByDiscordId(targetUser.id);
  if (!user) {
    await interaction.editReply({ content: '❌ User not found. They need to link their account first.' });
    return;
  }

  try {
    const { transactionId, newBalance } = db.adminAdjustBalance(user.id, amount, reason, interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle('🔧 Balance Adjusted')
      .setColor(0x57F287)
      .addFields(
        { name: 'User', value: `<@${targetUser.id}>`, inline: true },
        { name: 'Amount', value: `+${economy.formatMoney(amount)}`, inline: true },
        { name: 'New Balance', value: economy.formatMoney(newBalance), inline: true },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Transaction', value: `\`${transactionId.slice(0, 12)}...\``, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Log to audit channel
    await sendLogEvent('ADMIN_ADJUSTMENT', {
      discordUserId: targetUser.id,
      amount,
      status: 'COMPLETED',
      details: `Added ${economy.formatMoney(amount)} by <@${interaction.user.id}>. Reason: ${reason}`,
    });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleRemoveBalance(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const reason = interaction.options.getString('reason');

  const user = db.getUserByDiscordId(targetUser.id);
  if (!user) {
    await interaction.editReply({ content: '❌ User not found.' });
    return;
  }

  try {
    const { transactionId, newBalance } = db.adminAdjustBalance(user.id, -amount, reason, interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle('🔧 Balance Adjusted')
      .setColor(0xED4245)
      .addFields(
        { name: 'User', value: `<@${targetUser.id}>`, inline: true },
        { name: 'Amount', value: `-${economy.formatMoney(amount)}`, inline: true },
        { name: 'New Balance', value: economy.formatMoney(newBalance), inline: true },
        { name: 'Reason', value: reason, inline: false },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
}

async function handleUserInfo(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user');
  const profile = db.getUserProfile(targetUser.id);

  if (!profile) {
    await interaction.editReply({ content: '❌ User not found or not linked.' });
    return;
  }

  const embed = ui.createProfileEmbed(profile.user, profile.wallet, profile.mcAccount, targetUser);
  embed.setTitle('🔍 Admin: User Info');
  embed.addFields({ name: '🆔 Discord ID', value: targetUser.id, inline: false });

  await interaction.editReply({ embeds: [embed] });
}

async function handleMaintenance(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
    return;
  }

  const mode = interaction.options.getString('mode');
  db.setSetting('maintenance_mode', mode === 'on' ? 'true' : 'false');

  await interaction.reply({
    content: mode === 'on'
      ? '🔧 **Maintenance mode ENABLED.** Gambling, deposits, and withdrawals are now disabled for non-admin users.'
      : '✅ **Maintenance mode DISABLED.** All features are now available.',
    ephemeral: true,
  });
}

async function handleDatabaseStatus(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const status = db.getDatabaseStatus();
  const embed = ui.createDatabaseStatusEmbed(status);
  await interaction.editReply({ embeds: [embed] });
}

async function handleRefund(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const gameIdInput = interaction.options.getString('game_id');
  const database = db.getDb();
  const game = database.prepare('SELECT * FROM games WHERE game_id LIKE ?').get(`${gameIdInput}%`);

  if (!game) {
    await interaction.editReply({ content: '❌ Game not found.' });
    return;
  }

  if (game.status === 'COMPLETED' && game.result === 'WIN') {
    await interaction.editReply({ content: '❌ Cannot refund a completed winning game.' });
    return;
  }

  // Refund the bet
  const wallet = db.getOrCreateWallet(game.user_id);
  const refundTxnId = `ADMIN-REFUND-${game.game_id}-${Date.now()}`;
  const newBalance = wallet.balance + game.bet_amount;

  database.prepare(`
    INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
    VALUES (?, ?, ?, 'REFUND', ?, ?, ?, 'COMPLETED', 'GAME', ?, 'Admin refund')
  `).run(refundTxnId, game.user_id, wallet.id, game.bet_amount, wallet.balance, newBalance, game.game_id);

  database.prepare('UPDATE wallets SET balance = ? WHERE user_id = ?').run(newBalance, game.user_id);
  database.prepare(`UPDATE games SET status = 'REFUNDED' WHERE game_id = ?`).run(game.game_id);

  await interaction.editReply({
    content: `✅ Refunded ${economy.formatMoney(game.bet_amount)} for game \`${game.game_id}\`. New balance: ${economy.formatMoney(newBalance)}`,
  });
}

async function handleTransaction(interaction) {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const txnId = interaction.options.getString('transaction_id');
  const database = db.getDb();
  const txn = database.prepare('SELECT * FROM wallet_transactions WHERE transaction_id LIKE ?').get(`${txnId}%`);

  if (!txn) {
    await interaction.editReply({ content: '❌ Transaction not found.' });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 Transaction Details')
    .setColor(0x5865F2)
    .addFields(
      { name: 'Transaction ID', value: `\`${txn.transaction_id}\``, inline: false },
      { name: 'Type', value: txn.type, inline: true },
      { name: 'Amount', value: economy.formatMoney(txn.amount), inline: true },
      { name: 'Status', value: txn.status, inline: true },
      { name: 'Balance Before', value: economy.formatMoney(txn.balance_before), inline: true },
      { name: 'Balance After', value: economy.formatMoney(txn.balance_after), inline: true },
      { name: 'User ID', value: `${txn.user_id}`, inline: true },
      { name: 'Reason', value: txn.reason || 'N/A', inline: false },
      { name: 'Created', value: txn.created_at, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ============================================================
// BUTTON HANDLER
// ============================================================

async function handleButton(interaction) {
  const customId = interaction.customId;

  // Handle game buttons (blackjack, mines, tower, chicken, etc.)
  const gamePrefixes = ['bj_', 'mines_', 'tower_', 'chicken_', 'rakeback_', 'giveaway_'];
  if (gamePrefixes.some(prefix => customId.startsWith(prefix))) {
    await handleGameButton(interaction);
    return;
  }

  // Handle pagination buttons
  if (customId.includes('_prev') || customId.includes('_next') || customId.includes('_first') || customId.includes('_last')) {
    await interaction.reply({ content: '⏳ Pagination is handled via message updates.', ephemeral: true });
    return;
  }
}

// ============================================================
// HELPERS
// ============================================================

async function sendError(interaction, error) {
  const txnId = `ERR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const message = `❌ Something went wrong.\nTransaction ID: \`${txnId}\``;

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  } catch {
    // Ignore if we can't send
  }

  log.error({ error: error.message, stack: error.stack, txnId }, 'Command error');

  // Send to logs channel
  await sendLogEvent('ERROR', {
    discordUserId: interaction.user?.id,
    referenceId: txnId,
    details: error.message,
  });
}

async function sendLogEvent(eventType, data) {
  const logsChannelId = db.getSetting('logs_channel_id');
  if (!logsChannelId || !client) return;

  try {
    const channel = client.channels.cache.get(logsChannelId);
    if (!channel) return;

    const embed = ui.createLogEmbed(eventType, data);
    await channel.send({ embeds: [embed] });
  } catch (error) {
    log.error({ error: error.message }, 'Failed to send log event');
  }
}

function startStatusRotation(readyClient) {
  const statuses = [
    { name: '🎰 DonutSMP Economy', type: 0 },
    { name: '💰 /wallet', type: 3 },
    { name: '🎲 /coinflip', type: 3 },
    { name: '🔗 /link', type: 3 },
  ];

  let index = 0;
  setInterval(() => {
    readyClient.user.setPresence({
      activities: [statuses[index]],
      status: 'online',
    });
    index = (index + 1) % statuses.length;
  }, 30000);
}

export { client };
