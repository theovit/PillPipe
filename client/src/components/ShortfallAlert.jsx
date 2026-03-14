export default function ShortfallAlert({ result, supplementName }) {
  if (!result) return null;

  const { status, shortfall, pillsNeeded, inventory, bottlesNeeded, estimatedCost, waste } = result;

  if (status === 'covered') {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-green-900/30 border border-green-700/50 px-4 py-2 text-green-400 text-sm">
        <span>✓</span>
        <span>Covered through target date</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-3 text-sm space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-400 font-semibold">
          <span>⚠</span>
          <span>
            Grab {bottlesNeeded} bottle{bottlesNeeded !== 1 ? 's' : ''}
            {estimatedCost > 0 && <span className="text-red-300 font-normal"> · ${estimatedCost.toFixed(2)}</span>}
          </span>
        </div>
        <span className="text-red-500 text-xs">{shortfall} pills short</span>
      </div>
      <div className="text-gray-500 text-xs">
        Need {pillsNeeded} · have {inventory}
        {waste > 0 && <span> · {waste} leftover after purchase</span>}
      </div>
    </div>
  );
}
