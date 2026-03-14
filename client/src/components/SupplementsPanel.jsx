import { useState } from 'react';
import { api } from '../utils/api';

const EMPTY = { name: '', brand: '', pills_per_bottle: '', price: '', type: 'maintenance', current_inventory: '' };
const inputCls = 'rounded bg-gray-800 border border-gray-700 px-3 py-2.5 sm:py-1.5 text-base sm:text-sm text-gray-200 focus:outline-none focus:border-violet-500';

export default function SupplementsPanel({ supplements, onUpdate }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  function startEdit(s) {
    setEditingId(s.id);
    setEditForm({ name: s.name, brand: s.brand || '', pills_per_bottle: s.pills_per_bottle, price: s.price, type: s.type, current_inventory: s.current_inventory });
  }

  async function saveEdit(e) {
    e.preventDefault();
    await api.updateSupplement(editingId, {
      ...editForm,
      pills_per_bottle: parseInt(editForm.pills_per_bottle),
      price: parseFloat(editForm.price),
      current_inventory: parseInt(editForm.current_inventory) || 0,
    });
    setEditingId(null);
    onUpdate();
  }

  async function addSupplement(e) {
    e.preventDefault();
    await api.createSupplement({
      ...form,
      pills_per_bottle: parseInt(form.pills_per_bottle),
      price: parseFloat(form.price),
      current_inventory: parseInt(form.current_inventory) || 0,
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
      <div>
        <label className="block text-xs text-gray-500 mb-1">Pills/bottle</label>
        <input type="number" min="1" required value={f.pills_per_bottle}
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
        <label className="block text-xs text-gray-500 mb-1">On hand (pills)</label>
        <input type="number" min="0" required value={f.current_inventory}
          onChange={e => setF(p => ({ ...p, current_inventory: e.target.value }))}
          className={`w-full ${inputCls}`} placeholder="0" />
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
                      <span>{s.pills_per_bottle} pills/bottle · ${Number(s.price).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-300">{s.current_inventory} on hand</span>
                      <span className={`px-1.5 py-0.5 rounded ${s.type === 'maintenance' ? 'bg-blue-900/40 text-blue-400' : 'bg-amber-900/40 text-amber-400'}`}>
                        {s.type}
                      </span>
                    </div>
                  </div>
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
