import { describe, it, expect, beforeEach } from 'vitest';
import { googleCalendarStatus, disconnectGoogleCalendar } from '../integrations';
import { resetSettingsCacheForTesting, setPref } from '../settings';

describe('integrations', () => {
  beforeEach(() => {
    resetSettingsCacheForTesting();
  });

  it('returns truthful disconnected state when OAuth client id is missing', async () => {
    const status = await googleCalendarStatus();
    expect(status.connected).toBe(false);
    expect(status.detailKey).toBe('settingsGoogleBlocked');
  });

  it('reports sign-in required when client id exists but token is absent', async () => {
    await setPref('tempo_gcal_client_id', 'test-client-id.apps.googleusercontent.com');
    const status = await googleCalendarStatus();
    expect(status.connected).toBe(false);
    expect(status.detailKey).toBe('settingsGoogleMissing');
  });

  it('reports connected when token exists', async () => {
    await setPref('tempo_gcal_token', 'mock_token_123');
    const status = await googleCalendarStatus();
    expect(status.connected).toBe(true);
    expect(status.detailKey).toBe('settingsCalendarActive');
  });

  it('disconnectGoogleCalendar removes token', async () => {
    await setPref('tempo_gcal_token', 'mock_token_123');
    let status = await googleCalendarStatus();
    expect(status.connected).toBe(true);

    await disconnectGoogleCalendar();
    status = await googleCalendarStatus();
    expect(status.connected).toBe(false);
  });
});
