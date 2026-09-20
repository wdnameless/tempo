import { getPref, setPref } from './settings';

export interface IntegrationStatus {
  connected: boolean;
  /** Translation key, not a sentence: the screen renders it in the user's language. */
  detailKey: string | null;
}

/**
 * Returns the truthful status of the Google Calendar integration.
 * Google OAuth is wave 8 and is blocked on the user's Cloud project,
 * so Integrations and About show an honest status and the reason;
 * they do not offer a Connect that cannot connect.
 */
export async function googleCalendarStatus(): Promise<IntegrationStatus> {
  // Check if credentials or tokens exist in preferences
  const token = getPref<string | null>('tempo_gcal_token', null);
  const clientId = getPref<string | null>('tempo_gcal_client_id', null);

  if (token) {
    return {
      connected: true,
      detailKey: 'settingsCalendarActive',
    };
  }

  if (!clientId) {
    return {
      connected: false,
      detailKey: 'settingsGoogleBlocked',
    };
  }

  return {
    connected: false,
    detailKey: 'settingsGoogleMissing',
  };
}

/**
 * Disconnects the Google Calendar integration.
 */
export async function disconnectGoogleCalendar(): Promise<void> {
  await setPref('tempo_gcal_token', null);
}
