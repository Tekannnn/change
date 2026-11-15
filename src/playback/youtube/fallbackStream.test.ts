import { describe, expect, it } from 'vitest';
import { decryptSaavnMediaUrl, selectBestSaavnStream } from './fallbackStream';
import { AGE_GATE, BOT_GATE, permanentReason } from './resolver';

describe('JioSaavn DES-ECB decryption and stream selection', () => {
  it('decrypts a real encrypted_media_url payload to a JioSaavn CDN URL', () => {
    const encrypted =
      'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyfnh16+o8HcFiwkjKQgVgCgPuAOWtUYr97DEpT0LFfzuHiFUAvIsKnBw7tS9a8Gtq';
    const decrypted = decryptSaavnMediaUrl(encrypted);
    expect(decrypted).toMatch(/^https?:\/\/.*saavncdn\.com\/.*_\d+\.(mp4|aac|mp3)/i);
  });

  it('upgrades decrypted 96kbps URL to 320kbps HTTPS AAC when supported and preserves query parameters', () => {
    const encrypted =
      'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyfnh16+o8HcFiwkjKQgVgCgPuAOWtUYr97DEpT0LFfzuHiFUAvIsKnBw7tS9a8Gtq';
    const decrypted = decryptSaavnMediaUrl(encrypted);
    const stream = selectBestSaavnStream(decrypted, true);
    expect(stream).not.toBeNull();
    expect(stream!.kbps).toBe(320);
    expect(stream!.url).toMatch(/^https:\/\/aac\.saavncdn\.com\/.*_320\.mp4$/);

    const withQuery = selectBestSaavnStream('http://h.saavncdn.com/foo/bar_96.mp4?token=abc', true);
    expect(withQuery).toEqual({
      url: 'https://aac.saavncdn.com/foo/bar_320.mp4?token=abc',
      kbps: 320,
    });

    const lowOnly = selectBestSaavnStream('http://h.saavncdn.com/foo/bar_96.mp4', false);
    expect(lowOnly).toEqual({
      url: 'https://aac.saavncdn.com/foo/bar_96.mp4',
      kbps: 96,
    });
  });
});

describe('YouTube playability classification', () => {
  it('does not misclassify datacenter bot checks as age restrictions', () => {
    const botReason = 'Sign in to confirm you’re not a bot';
    expect(BOT_GATE.test(botReason.toLowerCase())).toBe(true);
    expect(AGE_GATE.test(botReason.toLowerCase())).toBe(false);
    expect(permanentReason('LOGIN_REQUIRED', botReason, false)).toBeNull();
  });

  it('recognizes real age-restriction prompts', () => {
    const ageReason = 'Sign in to confirm your age. This video may be inappropriate for some users.';
    expect(BOT_GATE.test(ageReason.toLowerCase())).toBe(false);
    expect(AGE_GATE.test(ageReason.toLowerCase())).toBe(true);
    expect(permanentReason('LOGIN_REQUIRED', ageReason, false)).toBe('This track is age-restricted on YouTube.');
  });
});
