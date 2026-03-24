import * as Notifications from 'expo-notifications';
import { AppPrefs } from './prefs';
import { RegNotif } from './types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ── Identifier helpers ────────────────────────────────────────────────────────

function presetId(regimenId: string, type: 'morning' | 'lunch' | 'dinner'): string {
  return `reminder-${regimenId}-${type}`;
}

function customId(entryId: string): string {
  return `reminder-${entryId}`;
}

export function resolveTime(
  type: RegNotif['type'],
  customTime: string | null,
  prefs: Pick<AppPrefs, 'morningTime' | 'lunchTime' | 'dinnerTime'>,
): string | null {
  if (type === 'custom') return customTime;
  if (type === 'morning') return prefs.morningTime;
  if (type === 'lunch') return prefs.lunchTime;
  if (type === 'dinner') return prefs.dinnerTime;
  return null;
}

// ── Schedule / cancel ─────────────────────────────────────────────────────────

export async function scheduleAllForRegimen(
  regimenId: string,
  supplementName: string,
  entries: RegNotif[],
  prefs: Pick<AppPrefs, 'morningTime' | 'lunchTime' | 'dinnerTime'>,
): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // Cancel all existing slots for this regimen first
  await cancelAllForRegimen(regimenId, entries.filter(e => e.type === 'custom').map(e => e.id));

  for (const entry of entries) {
    const time = resolveTime(entry.type, entry.custom_time, prefs);
    if (!time) continue;
    const [hh, mm] = time.split(':').map(Number);
    const identifier = entry.type === 'custom'
      ? customId(entry.id)
      : presetId(regimenId, entry.type as 'morning' | 'lunch' | 'dinner');

    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: 'PillPipe Reminder',
        body: `Time to take your ${supplementName}`,
        data: { regimenId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: hh,
        minute: mm,
      },
    });
  }
}

export async function cancelAllForRegimen(
  regimenId: string,
  customEntryIds: string[],
): Promise<void> {
  // Cancel deterministic preset identifiers
  for (const type of ['morning', 'lunch', 'dinner'] as const) {
    try {
      await Notifications.cancelScheduledNotificationAsync(presetId(regimenId, type));
    } catch { /* no-op if not scheduled */ }
  }
  // Cancel custom identifiers
  for (const id of customEntryIds) {
    try {
      await Notifications.cancelScheduledNotificationAsync(customId(id));
    } catch { /* no-op */ }
  }
}

export async function cancelSingleEntry(
  regimenId: string,
  entryId: string,
  type: RegNotif['type'],
): Promise<void> {
  const identifier = type === 'custom'
    ? customId(entryId)
    : presetId(regimenId, type as 'morning' | 'lunch' | 'dinner');
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch { /* no-op */ }
}
