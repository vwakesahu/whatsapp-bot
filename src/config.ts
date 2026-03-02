// Bun loads .env automatically — no dotenv needed

const config = {
  // Anthropic
  anthropicApiKey: Bun.env.ANTHROPIC_API_KEY ?? '',
  claudeModel: 'claude-sonnet-4-6' as const,

  // WhatsApp
  myNumber: Bun.env.MY_NUMBER ?? '',
  iskconGroupId: Bun.env.ISKCON_GROUP_ID ?? '',

  // Notifications
  ntfyTopic: Bun.env.NTFY_TOPIC ?? '',
  ntfyServer: Bun.env.NTFY_SERVER ?? 'https://ntfy.sh',

  // Whitelist — always notify for these contacts
  whitelistNumbers: (Bun.env.WHITELIST_NUMBERS ?? '')
    .split(',')
    .map(n => n.trim())
    .filter(Boolean),

  // Rate limiting
  rateLimit: {
    maxMessages: 6,
    windowSeconds: 60,
    silenceMinutes: 15,
    blacklistThreshold: 3,
  },

  // Conversation lifecycle
  conversation: {
    staleMinutes: 30,
    newWindowHours: 6,
    maxHistoryMessages: 20,
    cleanupIntervalMs: 5 * 60 * 1000,
  },

  // Database
  dbPath: './data/gatekeeper.db',
} as const;

export type Config = typeof config;
export default config;
