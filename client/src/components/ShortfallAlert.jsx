function fmtAmt(value, unit) {
  const v = Number(value);
  if (unit === 'drops') return `${v} drops`;
  if (unit === 'ml') return `${v} ml`;
  if (unit === 'tablets') return `${v} tabs`;
  return `${v} caps`;
}

export default function ShortfallAlert({ result, unit = 'capsules', drops_per_ml = 20 }) {
  if (!result) return null;

  const { status, shortfall, pillsNeeded, inventory, currentOnHand, bottlesNeeded, estimatedCost, waste } = result;

  if (status === 'covered') {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-green-900/20 border border-green-700/30 px-4 py-2.5 text-green-400 text-sm">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
        </svg>
        <span>Covered through target date</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-700/40 bg-amber-900/10 px-4 py-3 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-amber-400 font-medium">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span>Buy {bottlesNeeded} bottle{bottlesNeeded !== 1 ? 's' : ''}</span>
          {estimatedCost > 0 && (
            <span className="text-amber-300 font-semibold font-mono">${estimatedCost.toFixed(2)}</span>
          )}
        </div>
        <span className="text-red-400 text-xs font-mono shrink-0">{fmtAmt(shortfall, unit, drops_per_ml)} short</span>
      </div>
      <div className="text-gray-500 text-xs font-mono">
        need <span className="text-gray-400">{fmtAmt(pillsNeeded, unit, drops_per_ml)}</span>
        {' · '}have <span className="text-gray-400">{fmtAmt(currentOnHand ?? inventory, unit, drops_per_ml)}</span>
        {waste > 0 && <span> · <span className="text-gray-400">{fmtAmt(waste, unit, drops_per_ml)}</span> leftover</span>}
      </div>
    </div>
  );
}
