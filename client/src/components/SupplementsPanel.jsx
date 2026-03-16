import { useState } from 'react';
import { api } from '../utils/api';

const EMPTY = { name: '', brand: '', pills_per_bottle: '', price: '', type: 'maintenance', current_inventory: '', unit: 'capsules', drops_per_ml: 20, reorder_threshold: '', reorder_threshold_mode: 'units' };
const inputCls = 'rounded bg-gray-800 border border-gray-700 px-3 py-2.5 sm:py-1.5 text-base sm:text-sm text-gray-200 focus:outline-none focus:border-violet-500';

// ── Unit helpers ──────────────────────────────────────────────────────────────
function bottleLabel(unit) {
  if (unit === 'ml') return 'Volume/bottle (ml)';
  if (unit === 'drops') return 'Bottle size (ml)';
  if (unit === 'tablets') return 'Tabs/bottle';
  return 'Caps/bottle';
}
function inventoryLabel(unit) {
  if (unit === 'ml') return 'On hand (ml)';
  if (unit === 'drops') return 'On hand (drops)';
  if (unit === 'tablets') return 'On hand (tabs)';
  return 'On hand (caps)';
}
function parsePpb(val, unit) {
  return (unit === 'ml' || unit === 'drops') ? parseFloat(val) || 0 : parseInt(val) || 0;
}
function parseInv(val, unit) {
  return unit === 'ml' ? parseFloat(val) || 0 : parseInt(val) || 0;
}
function formatInventoryRow(value, unit, drops_per_ml = 20) {
  const v = Number(value);
  if (unit === 'drops') return `${v} drops (${(v / drops_per_ml).toFixed(1)} ml)`;
  if (unit === 'ml') return `${v} ml`;
  if (unit === 'tablets') return `${v} tab${v !== 1 ? 's' : ''}`;
  return `${v} cap${v !== 1 ? 's' : ''}`;
}
function unitShortLabel(unit) {
  if (unit === 'ml') return 'ml';
  if (unit === 'drops') return 'drops';
  if (unit === 'tablets') return 'tabs';
  return 'caps';
}
function formatBottleRow(ppb, unit) {
  const v = Number(ppb);
  if (unit === 'drops') return `${v} ml/bottle`;
  if (unit === 'ml') return `${v} ml/bottle`;
  if (unit === 'tablets') return `${v} tabs/bottle`;
  return `${v} caps/bottle`;
}

export default function SupplementsPanel({ supplements, onUpdate }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [localInventory, setLocalInventory] = useState({});

  function getInventory(s) {
    return localInventory[s.id] ?? s.current_inventory;
  }

  async function adjustInventory(e, s, delta) {
    e.stopPropagation();
    const next = Math.max(0, Number(getInventory(s)) + delta);
    setLocalInventory(prev => ({ ...prev, [s.id]: next }));
    await api.patchSupplement(s.id, { current_inventory: next });
    onUpdate();
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEditForm({
      name: s.name,
      brand: s.brand || '',
      pills_per_bottle: s.pills_per_bottle,
      price: s.price,
      type: s.type,
      current_inventory: s.current_inventory,
      unit: s.unit || 'capsules',
      drops_per_ml: s.drops_per_ml ?? 20,
      reorder_threshold: s.reorder_threshold ?? '',
      reorder_threshold_mode: s.reorder_threshold_mode || 'units',
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    const unit = editForm.unit;
    await api.updateSupplement(editingId, {
      ...editForm,
      pills_per_bottle: parsePpb(editForm.pills_per_bottle, unit),
      price: parseFloat(editForm.price),
      current_inventory: parseInv(editForm.current_inventory, unit),
      drops_per_ml: parseFloat(editForm.drops_per_ml) || 20,
      reorder_threshold: editForm.reorder_threshold !== '' ? parseFloat(editForm.reorder_threshold) : null,
      reorder_threshold_mode: editForm.reorder_threshold_mode || 'units',
    });
    setEditingId(null);
    onUpdate();
  }

  async function addSupplement(e) {
    e.preventDefault();
    const unit = form.unit;
    await api.createSupplement({
      ...form,
      pills_per_bottle: parsePpb(form.pills_per_bottle, unit),
      price: parseFloat(form.price),
      current_inventory: parseInv(form.current_inventory, unit),
      drops_per_ml: parseFloat(form.drops_per_ml) || 20,
      reorder_threshold: form.reorder_threshold !== '' ? parseFloat(form.reorder_threshold) : null,
      reorder_threshold_mode: form.reorder_threshold_mode || 'units',
    });
    setForm(EMPTY);
    setAdding(false);
    onUpdate();
  }

  async function deleteSupplement(id) {
    if (!window.confirm('Delete this supplement? It will be removed from all regimens.')) return;
    await api.deleteSupplement(id);
    onUpdate();
  }

  const typeSel = (val, setter) => (
    <div className="space-y-1">
      <select value={val} onChange={e => setter(e.target.value)}
        className={`w-full ${inputCls}`}>
        <option value="maintenance">Maintenance</option>
        <option value="protocol">Protocol</option>
      </select>
      <p className="text-xs text-gray-600">
        {val === 'maintenance'
          ? 'Taken daily long-term (e.g. vitamins, minerals).'
          : 'Finite course with defined phases (e.g. LDN taper).'}
      </p>
    </div>
  );

  const formFields = (f, setF) => (
    <div className="grid grid-cols-2 gap-2.5">
      <div className="col-span-2">
        <label className="block text-xs text-gray-500 mb-1">Name</label>
        <input required value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))}
          className={`w-full ${inputCls}`} placeholder="e.g. Magnesium Glycinate" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Brand</label>
        <input value={f.brand} onChange={e => setF(p => ({ ...p, brand: e.target.value }))}
          className={`w-full ${inputCls}`} placeholder="e.g. Thorne" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Type</label>
        {typeSel(f.type, v => setF(p => ({ ...p, type: v })))}
      </div>
      {/* Unit selector */}
      <div className="col-span-2">
        <label className="block text-xs text-gray-500 mb-1">Unit</label>
        <div className="flex gap-1.5">
          {['capsules', 'tablets', 'ml', 'drops'].map(u => (
            <button key={u} type="button"
              onClick={() => setF(p => ({ ...p, unit: u }))}
              className={`flex-1 py-2 sm:py-1.5 rounded text-xs font-medium transition-colors ${f.unit === u ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700'}`}>
              {u}
            </button>
          ))}
        </div>
      </div>
      {/* drops_per_ml override — only shown for drops */}
      {f.unit === 'drops' && (
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">
            Drops per ml <span className="text-gray-600">(default 20 — standard dropper)</span>
          </label>
          <input type="number" min="1" step="0.1" value={f.drops_per_ml}
            onChange={e => setF(p => ({ ...p, drops_per_ml: e.target.value }))}
            className={`w-32 ${inputCls}`} />
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-500 mb-1">{bottleLabel(f.unit)}</label>
        <input type="number" min="0.001" step={f.unit === 'ml' || f.unit === 'drops' ? '0.1' : '1'}
          required value={f.pills_per_bottle}
          onChange={e => setF(p => ({ ...p, pills_per_bottle: e.target.value }))}
          className={`w-full ${inputCls}`} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Price/bottle ($)</label>
        <input type="number" min="0" step="0.01" required value={f.price}
          onChange={e => setF(p => ({ ...p, price: e.target.value }))}
          className={`w-full ${inputCls}`} />
      </div>
      <div className="col-span-2">
        <label className="block text-xs text-gray-500 mb-1">{inventoryLabel(f.unit)}</label>
        <input type="number" min="0"
          step={f.unit === 'ml' ? '0.1' : '1'}
          required value={f.current_inventory}
          onChange={e => setF(p => ({ ...p, current_inventory: e.target.value }))}
          className={`w-full ${inputCls}`} placeholder="0" />
        {f.unit === 'drops' && f.drops_per_ml > 0 && f.current_inventory > 0 && (
          <p className="text-xs text-gray-600 mt-1">≈ {(Number(f.current_inventory) / Number(f.drops_per_ml)).toFixed(1)} ml</p>
        )}
      </div>
      <div className="col-span-2">
        <label className="block text-xs text-gray-500 mb-1">
          Reorder alert <span className="text-gray-600">— optional</span>
        </label>
        <div className="flex gap-2 items-stretch">
          <input type="number" min="0"
            step={f.reorder_threshold_mode === 'days' ? '1' : (f.unit === 'ml' ? '0.1' : '1')}
            value={f.reorder_threshold}
            onChange={e => setF(p => ({ ...p, reorder_threshold: e.target.value }))}
            className={`flex-1 ${inputCls}`} placeholder="Leave blank to disable" />
          <div className="flex rounded border border-gray-700 overflow-hidden shrink-0">
            <button type="button"
              onClick={() => setF(p => ({ ...p, reorder_threshold_mode: 'units' }))}
              className={`px-2.5 py-2 sm:py-1.5 text-xs font-medium transition-colors ${f.reorder_threshold_mode === 'units' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
              {unitShortLabel(f.unit)}
            </button>
            <button type="button"
              onClick={() => setF(p => ({ ...p, reorder_threshold_mode: 'days' }))}
              className={`px-2.5 py-2 sm:py-1.5 text-xs font-medium transition-colors border-l border-gray-700 ${f.reorder_threshold_mode === 'days' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
              days
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          {f.reorder_threshold_mode === 'days'
            ? 'Alert when days of supply remaining drops to or below this number.'
            : 'Alert when on-hand drops to or below this amount.'}
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Supplements</h2>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="px-4 py-2 sm:py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">
            + Add
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={addSupplement} className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-3">
          {formFields(form, setForm)}
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2.5 sm:py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">Add</button>
            <button type="button" onClick={() => { setAdding(false); setForm(EMPTY); }}
              className="px-4 py-2.5 sm:py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
        {supplements.length === 0 && (
          <p className="text-center text-gray-600 py-8 text-sm">No supplements yet.</p>
        )}
        {supplements.map((s, i) => (
          <div key={s.id} className={`${i > 0 ? 'border-t border-gray-800' : ''}`}>
            {editingId === s.id ? (
              <form onSubmit={saveEdit} className="p-4 space-y-3">
                {formFields(editForm, setEditForm)}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="px-4 py-2.5 sm:py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium">Save</button>
                  <button type="button" onClick={() => setEditingId(null)}
                    className="px-4 py-2.5 sm:py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
                  <button type="button" onClick={() => deleteSupplement(s.id)}
                    className="sm:hidden px-4 py-2.5 rounded border border-red-900 text-red-400 hover:text-red-300 text-sm ml-auto">Delete</button>
                </div>
              </form>
            ) : (
              <div className="flex items-center px-5 py-4 sm:py-3.5 gap-3 cursor-pointer" onClick={() => startEdit(s)}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white text-sm">{s.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5 space-y-0.5">
                    <div className="flex flex-wrap gap-x-1.5">
                      {s.brand && <span>{s.brand} ·</span>}
                      <span className="font-mono">{formatBottleRow(s.pills_per_bottle, s.unit || 'capsules')}</span>
                      <span> · </span>
                      <span className="font-mono">${Number(s.price).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-gray-300 font-mono">
                        {formatInventoryRow(getInventory(s), s.unit || 'capsules', s.drops_per_ml || 20)}
                      </span>
                      <span className="text-gray-500"> on hand</span>
                      {s.reorder_threshold != null && (() => {
                        const mode = s.reorder_threshold_mode || 'units';
                        const isLow = mode === 'days'
                          ? (s.days_remaining != null && Number(s.days_remaining) <= Number(s.reorder_threshold))
                          : Number(getInventory(s)) <= Number(s.reorder_threshold);
                        return isLow
                          ? <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-900/50 text-amber-400">⚠ low</span>
                          : null;
                      })()}
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium tracking-wide ${s.type === 'maintenance' ? 'bg-blue-900/40 text-blue-400' : 'bg-amber-900/40 text-amber-400'}`}>
                        {s.type}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <button onClick={e => adjustInventory(e, s, -1)}
                    className="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-base leading-none flex items-center justify-center">−</button>
                  <button onClick={e => adjustInventory(e, s, 1)}
                    className="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-base leading-none flex items-center justify-center">+</button>
                </div>
                <button onClick={e => { e.stopPropagation(); startEdit(s); }} className="hidden sm:block text-gray-500 hover:text-gray-300 p-2 shrink-0">✎</button>
                <button onClick={e => { e.stopPropagation(); deleteSupplement(s.id); }} className="hidden sm:block text-red-500 hover:text-red-400 p-2 shrink-0">✕</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
