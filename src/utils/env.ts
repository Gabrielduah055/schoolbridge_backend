/**
 * Environment validation — called once at the very start of main().
 *
 * If any required variable is missing the function prints a clear error list
 * and exits with code 1 so the Render deploy fails visibly instead of
 * starting a broken server that crashes on the first user request.
 */

interface EnvVar {
  key:      string;
  required: boolean;
  hint?:    string;   // shown when the var is missing
}

const ENV_VARS: EnvVar[] = [
  // ── Core ──────────────────────────────────────────────────────────────────
  {
    key:      'MONGODB_URL',
    required: true,
    hint:     'MongoDB connection string (get from MongoDB Atlas → Connect → Drivers)'
  },
  {
    key:      'TELEGRAM_BOT_TOKEN',
    required: true,
    hint:     'Get from @BotFather on Telegram'
  },
  {
    key:      'OPENROUTER_API_KEY',
    required: true,
    hint:     'Get from https://openrouter.ai/keys'
  },

  // ── School identity ───────────────────────────────────────────────────────
  {
    key:      'SCHOOL_NAME',
    required: true,
    hint:     'e.g. "Sunshine International School"'
  },

  // ── HTTP API protection ───────────────────────────────────────────────────
  {
    key:      'ADMIN_API_KEY',
    required: false,
    hint:     'Deprecated fallback only. Dashboard login should use JWT.'
  },
  {
    key:      'JWT_SECRET',
    required: true,
    hint:     'Generate with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  },
  {
    key:      'JWT_EXPIRES_IN',
    required: false,
    hint:     'JWT lifetime, e.g. 7d'
  },

  // ── Webhook (only required in production) ─────────────────────────────────
  {
    key:      'TELEGRAM_WEBHOOK_URL',
    required: process.env.NODE_ENV === 'production',
    hint:     'Your Render service URL, e.g. https://schoolbridge-backend.onrender.com'
  },
  {
    key:      'TELEGRAM_WEBHOOK_SECRET',
    required: process.env.NODE_ENV === 'production',
    hint:     'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  },

  // ── Optional but warned ───────────────────────────────────────────────────
  {
    key:      'ADMIN_TELEGRAM_GROUP_ID',
    required: false,
    hint:     'Telegram group ID for admin escalation notifications (e.g. -1001234567890). Add @userinfobot to your group to find it.'
  },
  {
    key:      'FRONTEND_URL',
    required: false,
    hint:     'Dashboard origin for CORS (e.g. https://your-dashboard.vercel.app)'
  },
  {
    key:      'WASENDER_API_TOKEN',
    required: false,
    hint:     'WasenderAPI session bearer token for WhatsApp Phase 1'
  },
  {
    key:      'WASENDER_BASE_URL',
    required: false,
    hint:     'WasenderAPI base URL, defaults to https://www.wasenderapi.com'
  },
  {
    key:      'WASENDER_SESSION_ID',
    required: false,
    hint:     'Safe Wasender session identifier/name for channel health display'
  },
  {
    key:      'WASENDER_WEBHOOK_SECRET',
    required: false,
    hint:     'Optional shared secret checked on incoming WhatsApp webhooks'
  }
];

export const validateEnv = (): void => {
  const missing: EnvVar[] = ENV_VARS.filter(
    v => v.required && !process.env[v.key]
  );

  const optional: EnvVar[] = ENV_VARS.filter(
    v => !v.required && !process.env[v.key]
  );

  if (missing.length > 0) {
    console.error('\n❌  Missing required environment variables:\n');
    for (const v of missing) {
      console.error(`  ${v.key}`);
      if (v.hint) console.error(`     → ${v.hint}`);
    }
    console.error('\nFix these in your .env file or Render dashboard, then restart.\n');
    process.exit(1);
  }

  if (optional.length > 0) {
    console.warn('⚠️  Optional environment variables not set (some features may be disabled):');
    for (const v of optional) {
      console.warn(`  ${v.key}${v.hint ? ` — ${v.hint}` : ''}`);
    }
    console.warn('');
  }
};
