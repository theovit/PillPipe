import { useState, useEffect } from 'react';
import { api } from '../utils/api';

function isoDate(d) { return d.toISOString().slice(0, 10); }

// todayStatus prop: 'taken' | 'skipped' | null (no log) | undefined (self-managed)
// onLogToday prop: (status) => void  — called instead of direct API when provided
export default function AdherenceCalendar({ regimenId, sessionStartDate, todayStatus: todayStatusProp, onLogToday }) {
  const [log, setLog] = useState({});   // date → 'taken' | 'skipped'  (historical + self-managed today)
  const [logging, setLogging] = useState(null);

  const today        = isoDate(new Date());
  const thirtyAgo    = isoDate(new Date(Date.now() - 29 * 86400000));
  const since        = sessionStartDate && sessionStartDate > thirtyAgo ? sessionStartDate : thirtyAgo;

  useEffect(() => {
    api.getDoseLog({ regimen_id: regimenId, since })
      .then(entries => {
        const map = {};
        for (const e of entries) map[e.date.slice(0, 10)] = e.status;
        setLog(map);
      })
      .catch(() => {});
  }, [regimenId, since]);

  async function handleLogToday(status) {
    setLogging(status);
    try {
      if (onLogToday) {
        await onLogToday(status);
      } else {
        const entry = await api.logDose({ regimen_id: regimenId, date: today, status });
        setLog(p => ({ ...p, [today]: entry.status }));
      }
    } finally {
      setLogging(null);
    }
  }

  // Build days array from `since` to today
  const days = [];
  for (let d = new Date(since); isoDate(d) <= today; d.setDate(d.getDate() + 1)) {
    days.push(isoDate(new Date(d)));
  }

  // When todayStatusProp is provided (even null), it overrides internal log for today.
  // undefined means self-contained mode (no parent managing today's state).
  const todayStatus = todayStatusProp !== undefined ? todayStatusProp : log[today];

  // Effective log: internal log with today overridden by prop (for accurate stats)
  const effectiveLog = (() => {
    if (todayStatusProp === undefined) return log;
    const base = { ...log };
    if (todayStatusProp) base[today] = todayStatusProp;
    else delete base[today];
    return base;
  })();

  const takenCount   = days.filter(d => effectiveLog[d] === 'taken').length;
  const skippedCount = days.filter(d => effectiveLog[d] === 'skipped').length;
  const loggedCount  = takenCount + skippedCount;
  const pct          = loggedCount > 0 ? Math.round((takenCount / loggedCount) * 100) : null;

  return (
    <div className="space-y-2.5">
      {/* 30-day dot grid */}
      <div className="flex flex-wrap gap-1">
        {days.map(day => {
          const status  = day === today ? todayStatus : effectiveLog[day];
          const isPast  = day < today;
          const isToday = day === today;
          let cls = 'w-4 h-4 rounded-sm flex-shrink-0 ';
          if      (status === 'taken')   cls += 'bg-green-500';
          else if (status === 'skipped') cls += 'bg-red-500/60';
          else if (isToday)              cls += 'bg-gray-600 ring-1 ring-gray-400';
          else if (isPast)               cls += 'bg-gray-800';
          else                           cls += 'bg-gray-800/40';
          return <div key={day} title={day} className={cls} />;
        })}
      </div>

      {/* Stats */}
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />
          {takenCount} taken
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500/60 inline-block" />
          {skippedCount} skipped
        </span>
        {pct !== null && (
          <span className="text-gray-400 font-medium">{pct}% adherence</span>
        )}
      </div>

      {/* Log today */}
      {!todayStatus ? (
        <div className="flex gap-2">
          <button
            disabled={!!logging}
            onClick={() => handleLogToday('taken')}
            className="px-3 py-1.5 rounded bg-green-800 hover:bg-green-700 disabled:opacity-40 text-green-200 text-xs font-medium">
            {logging === 'taken' ? '…' : '✓ Taken today'}
          </button>
          <button
            disabled={!!logging}
            onClick={() => handleLogToday('skipped')}
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 text-xs font-medium">
            {logging === 'skipped' ? '…' : '✗ Skip today'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <span className={`text-xs font-medium ${todayStatus === 'taken' ? 'text-green-400' : 'text-gray-400'}`}>
            {todayStatus === 'taken' ? '✓ Taken today' : '✗ Skipped today'}
          </span>
          <button
            disabled={!!logging}
            onClick={() => handleLogToday(todayStatus === 'taken' ? 'skipped' : 'taken')}
            className="text-xs text-gray-600 hover:text-gray-400 disabled:opacity-40">
            change
          </button>
        </div>
      )}
    </div>
  );
}
