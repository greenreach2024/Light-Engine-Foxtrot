import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url(),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(10),

  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("8h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  // Routing constraints
  ROUTE_MAX_STOPS: z.coerce.number().default(18),
  ROUTE_MAX_DURATION_MIN: z.coerce.number().default(270),
  COLD_CHAIN_MAX_MIN: z.coerce.number().default(180),

  // Pricing defaults
  COST_PER_KM: z.coerce.number().default(0.35),
  COST_PER_MIN: z.coerce.number().default(0.10),
  COST_PER_STOP: z.coerce.number().default(0.60),
  COST_PER_WAIT_MIN: z.coerce.number().default(0.08),
  ALLOC_W_KM: z.coerce.number().default(0.45),
  ALLOC_W_MIN: z.coerce.number().default(0.35),
  ALLOC_W_VOL: z.coerce.number().default(0.15),
  ALLOC_W_EQUAL: z.coerce.number().default(0.05),
  DEFAULT_MARGIN: z.coerce.number().default(0.55),

  // Driver pay defaults
  PAY_BASE: z.coerce.number().default(15.0),
  PAY_PER_KM: z.coerce.number().default(0.55),
  PAY_PER_ACTIVE_MIN: z.coerce.number().default(0.18),
  PAY_PER_STOP: z.coerce.number().default(1.25),
  PAY_PER_WAIT_MIN: z.coerce.number().default(0.20),
  MIN_EARNINGS_RATE_PER_MIN: z.coerce.number().default(0.35),
  WAIT_GRACE_MIN: z.coerce.number().default(10),

  // Depot coordinates (farm origin for dispatch)
  DEPOT_LAT: z.coerce.number().default(36.6777),
  DEPOT_LNG: z.coerce.number().default(-121.6555),

  // Tax rate for billing (0.13 = 13% HST)
  TAX_RATE: z.coerce.number().default(0.13),

  // Stripe (Phase 2 — payouts)
  STRIPE_SECRET_KEY: z.string().default("sk_test_placeholder"),
  STRIPE_WEBHOOK_SECRET: z.string().default("whsec_placeholder"),

  // S3 / Object storage (Phase 2 — driver documents)
  S3_BUCKET: z.string().default("lef-dev-uploads"),
  S3_REGION: z.string().default("us-east-1"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
