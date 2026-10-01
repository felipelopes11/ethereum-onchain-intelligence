import { redactUrl } from '@eoi/config';
import { runMigrations } from './client';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

try {
  await runMigrations(url);
  console.warn(`Migrations applied to ${redactUrl(url)}`);
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}
