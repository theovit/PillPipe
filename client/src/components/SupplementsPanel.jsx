import { useState } from 'react';
import { api } from '../utils/api';

const EMPTY = { name: '', brand: '', pills_per_bottle: '', price: '', type: 'maintenance', current_inventory: '' };

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
    await api.deleteSupplement(id);
    onUpdate();
  }

  const inputCls = 'rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-violet-500';
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Supplements</h2>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="px-3 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium">
            + Add
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={addSupplement} className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className={`w-full ${inputCls}`} placeholder="e.g. Magnesium Glycinate" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Brand</label>
              <input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                className={`w-full ${inputCls}`} placeholder="e.g. Thorne" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              {typeSel(form.type, v => setForm(f => ({ ...f, type: v })))}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Pills/bottle</label>
              <input type="number" min="1" required value={form.pills_per_bottle}
                onChange={e => setForm(f => ({ ...f, pills_per_bottle: e.target.value }))}
                className={`w-full ${inputCls}`} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Price/bottle ($)</label>
              <input type="number" min="0" step="0.01" required value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                className={`w-full ${inputCls}`} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">On hand (pills)</label>
              <input type="number" min="0" required value={form.current_inventory}
                onChange={e => setForm(f => ({ ...f, current_inventory: e.target.value }))}
                className={`w-full ${inputCls}`} placeholder="0" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-3 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm">Add</button>
            <button type="button" onClick={() => { setAdding(false); setForm(EMPTY); }}
              className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
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
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Name</label>
                    <input required value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                      className={`w-full ${inputCls}`} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Brand</label>
                    <input value={editForm.brand} onChange={e => setEditForm(f => ({ ...f, brand: e.target.value }))}
                      className={`w-full ${inputCls}`} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Type</label>
                    {typeSel(editForm.type, v => setEditForm(f => ({ ...f, type: v })))}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Pills/bottle</label>
                    <input type="number" min="1" required value={editForm.pills_per_bottle}
                      onChange={e => setEditForm(f => ({ ...f, pills_per_bottle: e.target.value }))}
                      className={`w-full ${inputCls}`} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Price/bottle ($)</label>
                    <input type="number" min="0" step="0.01" required value={editForm.price}
                      onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                      className={`w-full ${inputCls}`} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">On hand (pills)</label>
                    <input type="number" min="0" required value={editForm.current_inventory}
                      onChange={e => setEditForm(f => ({ ...f, current_inventory: e.target.value }))}
                      className={`w-full ${inputCls}`} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="px-3 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm">Save</button>
                  <button type="button" onClick={() => setEditingId(null)}
                    className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm">Cancel</button>
                </div>
              </form>
            ) : (
              <div className="flex items-center px-4 py-3 gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white text-sm">{s.name}</div>
                  <div className="text-xs text-gray-500">
                    {s.brand && <span>{s.brand} · </span>}
                    {s.pills_per_bottle} pills/bottle · ${Number(s.price).toFixed(2)} ·{' '}
                    <span className="text-gray-300">{s.current_inventory} on hand</span>
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${s.type === 'maintenance' ? 'bg-blue-900/40 text-blue-400' : 'bg-amber-900/40 text-amber-400'}`}>
                      {s.type}
                    </span>
                  </div>
                </div>
                <button onClick={() => startEdit(s)} className="text-gray-500 hover:text-gray-300 text-xs px-1 shrink-0">✎</button>
                <button onClick={() => deleteSupplement(s.id)} className="text-red-500 hover:text-red-400 text-xs px-1 shrink-0">✕</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
