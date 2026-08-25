/**
 * Keeps the bundled yt-dlp binary current.
 *
 * YouTube regularly changes its extraction/signature scheme, which breaks
 * whichever yt-dlp release predates the change - downloads then fail en masse
 * with 403s until a newer yt-dlp is installed. Self-updating on a schedule
 * turns that from a silent outage into a non-event.
 */

const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
const UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000; // twice a day

let currentVersion: string | null = null;
let lastUpdateCheck: Date | null = null;
let lastUpdateError: string | null = null;
let updateInProgress = false;

export function getYtdlpStatus() {
  return {
    version: currentVersion,
    lastUpdateCheck: lastUpdateCheck?.toISOString() ?? null,
    lastUpdateError,
  };
}

async function runYtdlp(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn([YTDLP_PATH, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { code, out: `${stdout}${stderr}`.trim() };
  } finally {
    clearTimeout(timer);
  }
}

export async function readYtdlpVersion(): Promise<string | null> {
  try {
    const { code, out } = await runYtdlp(['--version'], 30_000);
    if (code === 0 && out) {
      currentVersion = out.split('\n')[0]!.trim();
      return currentVersion;
    }
  } catch (e) {
    console.error('⚠️ Could not read yt-dlp version:', e);
  }
  return null;
}

/**
 * Ask yt-dlp to update itself in place. Never throws: a failed update leaves
 * the existing binary untouched, so the app keeps running on the old version.
 */
export async function updateYtdlp(): Promise<boolean> {
  if (updateInProgress) return false;
  updateInProgress = true;
  const before = currentVersion ?? (await readYtdlpVersion());

  try {
    console.log(`🔄 Checking for yt-dlp updates (current: ${before ?? 'unknown'})...`);
    const { code, out } = await runYtdlp(['-U'], 5 * 60 * 1000);
    lastUpdateCheck = new Date();

    if (code !== 0) {
      lastUpdateError = out || `yt-dlp -U exited with code ${code}`;
      console.error(`⚠️ yt-dlp self-update failed: ${lastUpdateError}`);
      return false;
    }

    lastUpdateError = null;
    const after = await readYtdlpVersion();

    if (after && before && after !== before) {
      console.log(`✅ yt-dlp updated: ${before} → ${after}`);
      return true;
    }
    console.log(`✅ yt-dlp is up to date (${after ?? 'unknown'})`);
    return false;
  } catch (e) {
    lastUpdateError = e instanceof Error ? e.message : String(e);
    console.error('⚠️ yt-dlp self-update errored:', lastUpdateError);
    return false;
  } finally {
    updateInProgress = false;
  }
}

/**
 * Check on boot and then periodically. Fire-and-forget - startup never blocks
 * on the network, and any failure is logged rather than fatal.
 */
export function startYtdlpAutoUpdate() {
  if (process.env.YTDLP_AUTO_UPDATE === 'false') {
    console.log('ℹ️ yt-dlp auto-update disabled via YTDLP_AUTO_UPDATE=false');
    readYtdlpVersion();
    return;
  }

  updateYtdlp();
  const timer = setInterval(() => { updateYtdlp(); }, UPDATE_INTERVAL_MS);
  // Don't hold the process open just for the update timer
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as { unref: () => void }).unref();
  }
}
