/**
 * DonutSMP Bot - Logger Module
 * Uses pino for structured logging.
 * NEVER logs sensitive credentials.
 */
import pino from 'pino';
import config from './config.js';

// Sensitive field filter - these keys are never logged
const SENSITIVE_KEYS = new Set([
  'token', 'password', 'secret', 'accessToken', 'refreshToken',
  'access_token', 'refresh_token', 'cookie', 'session',
  'DISCORD_TOKEN', 'MC_USERNAME', 'authorization',
]);

function redactSensitive(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitive(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

const logger = pino({
  level: config.LOG_LEVEL,
  transport: config.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  // Redact sensitive fields
  redact: {
    paths: [
      'token', 'password', 'secret', 'accessToken', 'refreshToken',
      'access_token', 'refresh_token', 'cookie', 'session',
      '*.token', '*.password', '*.secret',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with a specific component name.
 */
export function createLogger(component) {
  return logger.child({ component });
}

/**
 * Log a security event. These are always logged at warn level.
 */
export function logSecurityEvent(message, metadata = {}) {
  logger.warn({
    event: 'SECURITY',
    message,
    ...redactSensitive(metadata),
  });
}

/**
 * Log an audit event (admin actions, economy changes).
 */
export function logAuditEvent(action, metadata = {}) {
  logger.info({
    event: 'AUDIT',
    action,
    ...redactSensitive(metadata),
  });
}

export default logger;
