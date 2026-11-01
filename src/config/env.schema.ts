import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD_FILE: z.string().min(1),

  // Single connection string for psql / tooling / the grader (HW #3).
  // The app itself still connects via DB_HOST/../DB_PASSWORD_FILE above —
  // that's what makes password rotation without a restart possible.
  DATABASE_URL: z.string().url(),

  // RabbitMQ (HW #19), amqp://user:pass@host:5672. Optional: without it the API does
  // not publish order.placed. In real runs it comes from the secret store (HW #11).
  BROKER_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }

  return result.data;
}
