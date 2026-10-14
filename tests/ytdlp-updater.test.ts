import { beforeEach, describe, expect, test } from 'bun:test';
import { getYtdlpStatus, readYtdlpVersion, updateYtdlp } from '../src/services/ytdlp-updater';
import { fakeYtdlpUpdate, resetFakeYtdlp, setFakeYtdlpVersion, ytdlpCalls } from './helpers';

beforeEach(resetFakeYtdlp);

describe('yt-dlp self-update', () => {
  test('reads the installed version', async () => {
    setFakeYtdlpVersion('2026.01.01');
    expect(await readYtdlpVersion()).toBe('2026.01.01');
    expect(getYtdlpStatus().version).toBe('2026.01.01');
  });

  test('reports an update when the version changes', async () => {
    setFakeYtdlpVersion('2026.01.01', '2026.02.02');
    await readYtdlpVersion();

    expect(await updateYtdlp()).toBe(true);
    const status = getYtdlpStatus();
    expect(status.version).toBe('2026.02.02');
    expect(status.lastUpdateError).toBeNull();
    expect(status.lastUpdateCheck).not.toBeNull();
  });

  test('reports no update when already current', async () => {
    setFakeYtdlpVersion('2026.03.03');
    await readYtdlpVersion();
    expect(await updateYtdlp()).toBe(false);
    expect(getYtdlpStatus().lastUpdateError).toBeNull();
  });

  test('keeps the old version and records the error when the update fails', async () => {
    setFakeYtdlpVersion('2026.04.04');
    await readYtdlpVersion();
    fakeYtdlpUpdate({ fail: true });

    expect(await updateYtdlp()).toBe(false);
    const status = getYtdlpStatus();
    expect(status.version).toBe('2026.04.04');
    expect(status.lastUpdateError).toContain('network unreachable');
  });

  test('ignores a second update request while one is running', async () => {
    setFakeYtdlpVersion('2026.05.05');
    await readYtdlpVersion();
    fakeYtdlpUpdate({ seconds: 0.5 });

    const [first, second] = await Promise.all([updateYtdlp(), updateYtdlp()]);
    expect([first, second]).toEqual([false, false]);
    expect(ytdlpCalls().filter((c) => c === '-U')).toHaveLength(1);
  });
});
