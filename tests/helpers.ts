import { readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

// bunfig.toml's preload only applies when `bun test` runs from the repo root.
// Without it, tests would call the real yt-dlp.
if (!process.env.FAKE_YTDLP_STATE) {
  throw new Error('tests/setup.ts did not run: run `bun test` from the repo root');
}

// The fake yt-dlp (tests/fixtures/fake-yt-dlp) reads its settings from files
// in this dir; tests/setup.ts creates it.
const state = (file: string) => join(process.env.FAKE_YTDLP_STATE!, file);

const SETTINGS = ['calls.log', 'next-version', 'stdout', 'stderr', 'exit', 'update-fail', 'sleep'];

/** Each line is the argument list of one fake yt-dlp invocation. */
export function ytdlpCalls(): string[] {
  try {
    return readFileSync(state('calls.log'), 'utf-8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Clear the call log and any per-test fake yt-dlp settings. */
export function resetFakeYtdlp(): void {
  for (const file of SETTINGS) rmSync(state(file), { force: true });
}

/** Make the fake yt-dlp print `stdout` for the next search/info call. */
export function fakeYtdlpOutput(stdout: string, opts: { stderr?: string; exitCode?: number } = {}): void {
  writeFileSync(state('stdout'), stdout);
  if (opts.stderr) writeFileSync(state('stderr'), opts.stderr);
  if (opts.exitCode !== undefined) writeFileSync(state('exit'), String(opts.exitCode));
}

export function setFakeYtdlpVersion(version: string, next?: string): void {
  writeFileSync(state('version'), version + '\n');
  if (next) writeFileSync(state('next-version'), next + '\n');
}

/** Make the next `yt-dlp -U` fail, or take `seconds` to finish. */
export function fakeYtdlpUpdate(opts: { fail?: boolean; seconds?: number }): void {
  if (opts.fail) writeFileSync(state('update-fail'), '1');
  if (opts.seconds) writeFileSync(state('sleep'), String(opts.seconds));
}

export async function audioDuration(path: string): Promise<number> {
  const proc = Bun.spawn(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  return parseFloat(await new Response(proc.stdout).text());
}
