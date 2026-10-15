/**
 * Test preload (see bunfig.toml). The services read these env vars when they
 * are first imported, so this has to run before any test file loads them.
 *
 * This machine is the production server: without this, `bun test` would write
 * fake mixes into analytics.db (and from there onto the landing pages) and
 * call the real yt-dlp.
 */
import { afterAll } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'kpop-test-'));
// afterAll in a preload runs once, after every test file has finished.
afterAll(() => rmSync(dir, { recursive: true, force: true }));

process.env.ANALYTICS_DB_PATH = join(dir, 'analytics.db');
process.env.CACHE_DB_PATH = join(dir, 'cache.db');

// A shell script stands in for yt-dlp (tests/fixtures/fake-yt-dlp). Bun.spawn
// doesn't pass on env changes made at runtime, so a wrapper bakes in where the
// fake keeps its state, and tests steer it with files there (see helpers.ts).
const fake = join(import.meta.dir, 'fixtures', 'fake-yt-dlp');
const audio = join(import.meta.dir, '..', 'assets', 'countdown.mp3');
const wrapper = join(dir, 'yt-dlp');
writeFileSync(
  wrapper,
  `#!/usr/bin/env bash\nexport FAKE_YTDLP_STATE='${dir}' FAKE_YTDLP_AUDIO='${audio}'\nexec '${fake}' "$@"\n`,
);
chmodSync(wrapper, 0o755);
writeFileSync(join(dir, 'version'), '2026.01.01\n');

process.env.YTDLP_PATH = wrapper;
process.env.YTDLP_AUTO_UPDATE = 'false';
process.env.FAKE_YTDLP_STATE = dir;

process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-password';

// Bun loads .env automatically; never let a test reach the real Resend account.
delete process.env.RESEND_API_KEY;
delete process.env.CONTACT_TO_EMAIL;
// Nor let the live site's maintenance switch leak into tests that expect it off.
delete process.env.MAINTENANCE_MODE;
delete process.env.MAINTENANCE_BYPASS_KEY;
