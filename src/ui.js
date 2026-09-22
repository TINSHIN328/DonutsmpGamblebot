/**
 * DonutSMP Bot - UI Module
 * Discord embeds, buttons, and pagination helpers.
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import config from './config.js';
import { formatMoney } from './economy.js';

/**
 * Create a wallet display embed.
 */
export function createWalletEmbed(wallet, discordUser, mcAccount) {
  const winRate = wallet.games_played > 0
    ? ((wallet.wins / wallet.games_played) * 100).toFixed(1)
    : '0.0';

  const embed = new EmbedBuilder()
    .setTitle('💰 Wallet')
    .setColor(0x5865F2)
    .setThumbnail(discordUser.displayAvatarURL())
    .addFields(
      { name: '💵 Balance', value: formatMoney(wallet.balance), inline: false },
      { name: '📥 Total Deposited', value: formatMoney(wallet.total_deposited), inline: true },
      { name: '📤 Total Withdrawn', value: formatMoney(wallet.total_withdrawn), inline: true },
      { name: '🎲 Total Wagered', value: formatMoney(wallet.total_wagered), inline: true },
      { name: '🏆 Total Won', value: formatMoney(wallet.total_won), inline: true },
      { name: '💸 Total Lost', value: formatMoney(wallet.total_lost), inline: true },
      { name: '🎮 Games Played', value: `${wallet.games_played}`, inline: true },
      { name: '✅ Wins', value: `${wallet.wins}`, inline: true },
      { name: '❌ Losses', value: `${wallet.losses}`, inline: true },
      { name: '📊 Win Rate', value: `${winRate}%`, inline: true },
    )
    .setTimestamp();

  if (mcAccount) {
    embed.addFields(
      { name: '🎮 Minecraft', value: mcAccount.minecraft_username, inline: true },
    );
  }

  embed.setFooter({ text: `DonutSMP Economy | Tax: ${config.GAME_TAX_PERCENT}% on profits` });

  return embed;
}

/**
 * Create a profile embed.
 */
export function createProfileEmbed(user, wallet, mcAccount, discordUser) {
  const winRate = wallet.games_played > 0
    ? ((wallet.wins / wallet.games_played) * 100).toFixed(1)
    : '0.0';

  const embed = new EmbedBuilder()
    .setTitle('👤 Player Profile')
    .setColor(0x57F287)
    .setThumbnail(discordUser.displayAvatarURL())
    .addFields(
      { name: '👤 Discord', value: `<@${user.discord_user_id}>`, inline: false },
      { name: '🎮 Minecraft Username', value: mcAccount?.minecraft_username || 'Not linked', inline: true },
      { name: '🆔 Minecraft UUID', value: mcAccount ? `\`${mcAccount.minecraft_uuid.slice(0, 8)}...\`` : 'N/A', inline: true },
      { name: '💰 Balance', value: formatMoney(wallet.balance), inline: true },
      { name: '🎲 Total Wagered', value: formatMoney(wallet.total_wagered), inline: true },
      { name: '🏆 Total Won', value: formatMoney(wallet.total_won), inline: true },
      { name: '💸 Total Lost', value: formatMoney(wallet.total_lost), inline: true },
      { name: '🎮 Games Played', value: `${wallet.games_played}`, inline: true },
      { name: '📊 Win Rate', value: `${winRate}%`, inline: true },
      { name: '📅 Joined', value: `<t:${Math.floor(new Date(user.created_at).getTime() / 1000)}:R>`, inline: true },
    )
    .setTimestamp();

  return embed;
}

/**
 * Create a game result embed.
 */
export function createGameResultEmbed(result) {
  const { gameType, won, betAmount, grossPayout, profit, taxAmount, netProfit, finalBalance, gameData, gameId } = result;

  const color = won ? 0x57F287 : 0xED4245;
  const emoji = won ? '🎉' : '😢';

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${gameType.charAt(0).toUpperCase() + gameType.slice(1)} - ${won ? 'YOU WIN!' : 'YOU LOSE'}`)
    .setColor(color)
    .addFields(
      { name: '💰 Bet', value: formatMoney(betAmount), inline: true },
    );

  if (won) {
    embed.addFields(
      { name: '📊 Gross Payout', value: formatMoney(grossPayout), inline: true },
      { name: '📈 Gross Profit', value: formatMoney(profit), inline: true },
      { name: `🏛️ Game Tax (${config.GAME_TAX_PERCENT}%)`, value: formatMoney(taxAmount), inline: true },
      { name: '💵 Net Profit', value: `+${formatMoney(netProfit)}`, inline: true },
    );
  } else {
    embed.addFields(
      { name: '💸 Lost', value: formatMoney(betAmount), inline: true },
      { name: '🏛️ Tax', value: '$0 (no tax on losses)', inline: true },
    );
  }

  embed.addFields(
    { name: '🏦 Final Balance', value: formatMoney(finalBalance), inline: false },
    { name: '🎫 Game ID', value: `\`${gameId.slice(0, 8)}...\``, inline: true },
  );

  // Add game-specific data
  if (gameData) {
    if (gameData.choice || gameData.result) {
      const details = [];
      if (gameData.choice) details.push(`Your choice: ${gameData.choice}`);
      if (gameData.result) details.push(`Result: ${gameData.result}`);
      if (gameData.chosenNumber) details.push(`Your number: ${gameData.chosenNumber}`);
      if (gameData.betType) details.push(`Bet type: ${gameData.betType}`);
      if (gameData.cashoutAt) details.push(`Cashout at: ${gameData.cashoutAt}x`);
      if (gameData.crashPoint) details.push(`Crashed at: ${gameData.crashPoint}x`);

      if (details.length > 0) {
        embed.addFields({ name: '📋 Details', value: details.join('\n'), inline: false });
      }
    }
  }

  // Show provably fair info
  embed.addFields({
    name: '🔐 Provably Fair',
    value: `Seed Hash: \`${result.serverSeedHash.slice(0, 16)}...\`\nUse \`/verify ${gameId.slice(0, 8)}\` to verify`,
    inline: false,
  });

  embed.setTimestamp();
  embed.setFooter({ text: `DonutSMP Economy | ${config.GAME_TAX_PERCENT}% tax on profits` });

  return embed;
}

/**
 * Create a status embed.
 */
export function createStatusEmbed(statusData) {
  const embed = new EmbedBuilder()
    .setTitle('📊 Bot Status')
    .setColor(0x5865F2)
    .addFields(
      {
        name: 'Discord',
        value: statusData.discord ? '🟢 Online' : '🔴 Offline',
        inline: true,
      },
      {
        name: 'Minecraft',
        value: statusData.minecraft?.connected ? '🟢 Connected' : '🔴 Disconnected',
        inline: true,
      },
      {
        name: 'Database',
        value: statusData.database?.connected ? '🟢 Connected' : '🔴 Disconnected',
        inline: true,
      },
      {
        name: 'Pending Transactions',
        value: `${statusData.database?.pendingTransactions || 0}`,
        inline: true,
      },
      {
        name: 'Pending Games',
        value: `${statusData.database?.pendingGames || 0}`,
        inline: true,
      },
      {
        name: 'Pending Withdrawals',
        value: `${statusData.database?.pendingWithdrawals || 0}`,
        inline: true,
      },
      {
        name: '⏱️ Uptime',
        value: formatUptime(process.uptime()),
        inline: true,
      },
      {
        name: '💾 Memory',
        value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        inline: true,
      },
      {
        name: '📦 Version',
        value: statusData.version || '1.0.0',
        inline: true,
      },
    )
    .setTimestamp();

  if (statusData.minecraft?.connected) {
    embed.addFields({
      name: '🎮 Minecraft Server',
      value: `${statusData.minecraft.host}:${statusData.minecraft.port}`,
      inline: false,
    });
  }

  return embed;
}

/**
 * Create a database status embed.
 */
export function createDatabaseStatusEmbed(dbStatus) {
  const embed = new EmbedBuilder()
    .setTitle('🗄️ Database Status')
    .setColor(0x5865F2)
    .addFields(
      {
        name: 'Status',
        value: dbStatus.connected ? '🟢 Connected' : '🔴 Disconnected',
        inline: true,
      },
      {
        name: 'Size',
        value: dbStatus.sizeFormatted || 'N/A',
        inline: true,
      },
      {
        name: 'Last Backup',
        value: dbStatus.lastBackup ? `<t:${Math.floor(new Date(dbStatus.lastBackup).getTime() / 1000)}:R>` : 'Never',
        inline: true,
      },
      {
        name: 'Pending Transactions',
        value: `${dbStatus.pendingTransactions || 0}`,
        inline: true,
      },
      {
        name: 'Pending Games',
        value: `${dbStatus.pendingGames || 0}`,
        inline: true,
      },
      {
        name: 'Pending Withdrawals',
        value: `${dbStatus.pendingWithdrawals || 0}`,
        inline: true,
      },
      {
        name: 'Last Migration',
        value: dbStatus.lastMigration || 'none',
        inline: true,
      },
    )
    .setTimestamp();

  return embed;
}

/**
 * Create a transaction history embed.
 */
export function createHistoryEmbed(transactions, page, totalPages) {
  const embed = new EmbedBuilder()
    .setTitle('📜 Transaction History')
    .setColor(0x5865F2)
    .setFooter({ text: `Page ${page + 1} of ${totalPages}` });

  if (transactions.length === 0) {
    embed.setDescription('No transactions found.');
    return embed;
  }

  const lines = transactions.map(txn => {
    const emoji = getTypeEmoji(txn.type);
    const amount = txn.amount >= 0 ? `+${formatMoney(txn.amount)}` : formatMoney(txn.amount);
    const time = `<t:${Math.floor(new Date(txn.created_at).getTime() / 1000)}:R>`;
    return `${emoji} **${txn.type}** — ${amount} — ${time}`;
  });

  embed.setDescription(lines.join('\n'));
  return embed;
}

/**
 * Create game history embed.
 */
export function createGameHistoryEmbed(games, page, totalPages) {
  const embed = new EmbedBuilder()
    .setTitle('🎮 Game History')
    .setColor(0x5865F2)
    .setFooter({ text: `Page ${page + 1} of ${totalPages}` });

  if (games.length === 0) {
    embed.setDescription('No games found.');
    return embed;
  }

  const lines = games.map(game => {
    const emoji = game.result === 'WIN' ? '✅' : game.result === 'LOSS' ? '❌' : '⏳';
    const gameName = game.game_type.charAt(0).toUpperCase() + game.game_type.slice(1);
    const payout = game.net_payout >= 0 ? `+${formatMoney(game.net_payout)}` : formatMoney(game.net_payout);
    return `${emoji} **${gameName}** — Bet: ${formatMoney(game.bet_amount)} — ${payout} — \`${game.game_id.slice(0, 8)}\``;
  });

  embed.setDescription(lines.join('\n'));
  return embed;
}

/**
 * Create log embed for audit channel.
 */
export function createLogEmbed(eventType, data) {
  const colors = {
    ACCOUNT_LINKED: 0x57F287,
    ACCOUNT_UNLINKED: 0xFEE75C,
    DEPOSIT_CREATED: 0x3498DB,
    DEPOSIT_CONFIRMED: 0x57F287,
    WITHDRAW_REQUESTED: 0xE67E22,
    WITHDRAW_COMPLETED: 0x57F287,
    WITHDRAW_FAILED: 0xED4245,
    GAME_STARTED: 0x9B59B6,
    GAME_COMPLETED: 0x5865F2,
    BIG_WIN: 0xFFD700,
    ADMIN_ADJUSTMENT: 0xE91E63,
    BOT_CONNECTED: 0x57F287,
    BOT_DISCONNECTED: 0xED4245,
    ERROR: 0xED4245,
    SECURITY_EVENT: 0xFF0000,
  };

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${eventType}`)
    .setColor(colors[eventType] || 0x5865F2)
    .setTimestamp();

  if (data.discordUserId) {
    embed.addFields({ name: 'Discord User', value: `<@${data.discordUserId}>`, inline: true });
  }
  if (data.minecraftUsername) {
    embed.addFields({ name: 'Minecraft', value: data.minecraftUsername, inline: true });
  }
  if (data.referenceId) {
    embed.addFields({ name: 'Reference', value: `\`${data.referenceId}\``, inline: true });
  }
  if (data.amount !== undefined) {
    embed.addFields({ name: 'Amount', value: formatMoney(data.amount), inline: true });
  }
  if (data.status) {
    embed.addFields({ name: 'Status', value: data.status, inline: true });
  }
  if (data.details) {
    embed.setDescription(typeof data.details === 'string' ? data.details.slice(0, 1000) : JSON.stringify(data.details).slice(0, 1000));
  }

  return embed;
}

/**
 * Create pagination buttons.
 */
export function createPaginationButtons(page, totalPages, prefix) {
  const row = new ActionRowBuilder();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_first`)
      .setLabel('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`${prefix}_prev`)
      .setLabel('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`${prefix}_page`)
      .setLabel(`${page + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${prefix}_next`)
      .setLabel('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`${prefix}_last`)
      .setLabel('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );

  return row;
}

/**
 * Create coinflip choice buttons.
 */
export function createCoinflipButtons(gameId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`coinflip_heads_${gameId}`)
      .setLabel('🪙 Heads')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`coinflip_tails_${gameId}`)
      .setLabel('🪙 Tails')
      .setStyle(ButtonStyle.Danger),
  );

  return row;
}

/**
 * Create confirmation buttons.
 */
export function createConfirmButtons(actionId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_yes_${actionId}`)
      .setLabel('✅ Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`confirm_no_${actionId}`)
      .setLabel('❌ Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return row;
}

// Helpers
function getTypeEmoji(type) {
  const emojis = {
    DEPOSIT: '📥',
    WITHDRAW: '📤',
    BET: '🎲',
    WIN: '🏆',
    LOSS: '💸',
    TAX: '🏛️',
    REFUND: '💰',
    ADMIN_ADJUSTMENT: '🔧',
    RESERVATION: '🔒',
    RESERVATION_RELEASE: '🔓',
  };
  return emojis[type] || '📋';
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);

  return parts.join(' ');
}
