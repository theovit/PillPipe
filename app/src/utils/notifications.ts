import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function scheduleReminder(regimenId: string, supplementName: string, hh: number, mm: number) {
  // Cancel existing reminder for this regimen first
  await cancelReminder(regimenId);

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  await Notifications.scheduleNotificationAsync({
    identifier: `reminder-${regimenId}`,
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

export async function cancelReminder(regimenId: string) {
  try {
    await Notifications.cancelScheduledNotificationAsync(`reminder-${regimenId}`);
  } catch { /* no-op */ }
}
