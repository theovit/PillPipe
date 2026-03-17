import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getDb, uuid } from '@/db/database';
import { todayISO } from '@/utils/dates';

type Status = 'taken' | 'skipped';

interface Props {
  regimenId: string;
  sessionStartDate: string;
  /** Controlled today status from parent. undefined = self-managed. */
  todayStatus?: Status | null;
  onLogToday?: (status: Status) => void;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function AdherenceCalendar({ regimenId, sessionStartDate, todayStatus: todayStatusProp, onLogToday }: Props) {
  const [log, setLog] = useState<Record<string, Status>>({});

  const today     = todayISO();
  const thirtyAgo = isoDate(new Date(Date.now() - 29 * 86400000));
  const since     = sessionStartDate > thirtyAgo ? sessionStartDate : thirtyAgo;

  useEffect(() => {
    (async () => {
      try {
        const db = await getDb();
        const rows = await db.getAllAsync<{ log_date: string; status: Status }>(
          'SELECT log_date, status FROM dose_log WHERE regimen_id = ? AND log_date >= ? ORDER BY log_date',
          [regimenId, since],
        );
        const map: Record<string, Status> = {};
        for (const r of rows) map[r.log_date] = r.status;
        setLog(map);
      } catch { /* no-op */ }
    })();
  }, [regimenId, since]);

  async function handleLogToday(status: Status) {
    if (onLogToday) {
      onLogToday(status);
    } else {
      setLog((prev) => ({ ...prev, [today]: status }));
      try {
        const db = await getDb();
        await db.runAsync(
          `INSERT INTO dose_log (id, regimen_id, log_date, status)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (regimen_id, log_date) DO UPDATE SET status = excluded.status`,
          [uuid(), regimenId, today, status],
        );
      } catch { /* non-critical */ }
    }
  }

  // Build day array from since → today
  const days: string[] = [];
  for (const d = new Date(since); isoDate(d) <= today; d.setDate(d.getDate() + 1)) {
    days.push(isoDate(new Date(d)));
  }

  const todayStatus = todayStatusProp !== undefined ? todayStatusProp : log[today];
  const effectiveLog = (() => {
    if (todayStatusProp === undefined) return log;
    const base = { ...log };
    if (todayStatusProp) base[today] = todayStatusProp;
    else delete base[today];
    return base;
  })();

  const takenCount   = days.filter((d) => effectiveLog[d] === 'taken').length;
  const skippedCount = days.filter((d) => effectiveLog[d] === 'skipped').length;
  const loggedCount  = takenCount + skippedCount;
  const pct          = loggedCount > 0 ? Math.round((takenCount / loggedCount) * 100) : null;

  return (
    <View className="gap-2">
      {/* Dot grid */}
      <View className="flex-row flex-wrap gap-1">
        {days.map((day) => {
          const status  = day === today ? todayStatus : effectiveLog[day];
          const isToday = day === today;
          const isPast  = day < today;
          let bg = 'bg-gray-800/40';
          if      (status === 'taken')   bg = 'bg-green-500';
          else if (status === 'skipped') bg = 'bg-red-500/60';
          else if (isToday)              bg = 'bg-gray-600 ring-1 ring-gray-400';
          else if (isPast)               bg = 'bg-gray-800';
          return <View key={day} className={`w-4 h-4 rounded-sm ${bg}`} />;
        })}
      </View>

      {/* Stats */}
      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        <View className="flex-row items-center gap-1">
          <View className="w-2.5 h-2.5 rounded-sm bg-green-500" />
          <Text className="text-gray-500 text-xs">{takenCount} taken</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View className="w-2.5 h-2.5 rounded-sm bg-red-500/60" />
          <Text className="text-gray-500 text-xs">{skippedCount} skipped</Text>
        </View>
        {pct !== null && (
          <Text className="text-gray-400 text-xs font-medium">{pct}% adherence</Text>
        )}
      </View>
    </View>
  );
}
