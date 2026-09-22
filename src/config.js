/**
 * DonutSMP Bot - Configuration Module
 * Loads and validates all environment variables using Zod.
 */
import { z } from 'zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configSchema = z.object({
  // Discord
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  ADMIN_ROLE_ID: z.string().min(1, 'ADMIN_ROLE_ID is required'),

  // Minecraft
  MC_HOST: z.string().min(1, 'MC_HOST is required'),
  MC_PORT: z.coerce.number().int().min(1).max(65535).default(25565),
  MC_USERNAME: z.string().min(1, 'MC_USERNAME is required'),
  MC_AUTH: z.enum(['microsoft']).default('microsoft'),

  // Database
  DATABASE_PATH: z.string().default('./data/database.sqlite'),

  // Database Backups
  DATABASE_BACKUP_ENABLED: z.coerce.boolean().default(true),
  DATABASE_BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(1).default(6),
  DATABASE_BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),

  // Economy
  GAME_TAX_PERCENT: z.coerce.number().min(0).max(100).default(15),
  WITHDRAW_TAX_PERCENT: z.coerce.number().min(0).max(100).default(10),
  MIN_BET: z.coerce.number().int().min(1).default(1000),
  MAX_BET: z.coerce.number().int().min(1).default(100000000),
  HOUSE_EDGE_PERCENT: z.coerce.number().min(0).max(100).default(0),
  BIG_WIN_THRESHOLD: z.coerce.number().int().min(1).default(100000000),
  STARTING_BALANCE: z.coerce.number().int().min(0).default(1000000),

  // Anti-Abuse
  MAX_DAILY_WAGER: z.coerce.number().int().min(1).default(500000000),
  MAX_WITHDRAW_PER_DAY: z.coerce.number().int().min(1).default(100000000),
  WITHDRAW_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(300),
  COINFLIP_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(5),
  GENERAL_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(3),

  // Bot
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

let config;

try {
  config = configSchema.parse(process.env);
} catch (err) {
  if (err instanceof z.ZodError) {
    console.error('❌ Configuration validation failed:');
    for (const issue of err.issues) {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\nPlease check your .env file. See .env.example for reference.');
    process.exit(1);
  }
  throw err;
}

// Resolve database path relative to project root
const projectRoot = path.resolve(__dirname, '..');
if (!path.isAbsolute(config.DATABASE_PATH)) {
  config.DATABASE_PATH = path.resolve(projectRoot, config.DATABASE_PATH);
}

export default config;
export { configSchema };
