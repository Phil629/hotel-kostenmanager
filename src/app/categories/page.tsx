'use client';

import { useState, useEffect } from 'react';

interface Category {
  id: string;
  name: string;
  color: string;
  description: string | null;
  isHotelCore: boolean;
  _count?: {
    transactions: number;
    rules: number;
  };
}

const defaultColors = [
  '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444',
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#6366f1',
  '#14b8a6', '#d97706', '#a855f7', '#f43f5e'
];

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states (Create)
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Edit Modal State
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#3b82f6');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      setCategories(data.categories || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color, description }),
      });

      const data = await res.json();
      if (data.success) {
        setMsg(`✅ Kategorie "${name}" erfolgreich erstellt!`);
        setName('');
        setDescription('');
        fetchCategories();
      } else {
        setMsg(`❌ Fehler: ${data.error}`);
      }
    } catch (err: any) {
      setMsg(`❌ Fehler: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEditCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !editName.trim()) return;

    setSavingEdit(true);
    setMsg(null);
    try {
      const res = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingCategory.id,
          name: editName,
          color: editColor,
          description: editDescription,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMsg(`✅ Kategorie "${editName}" erfolgreich aktualisiert!`);
        setEditingCategory(null);
        fetchCategories();
      } else {
        setMsg(`❌ Fehler beim Speichern: ${data.error}`);
      }
    } catch (err: any) {
      setMsg(`❌ Fehler: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteCategory = async (id: string, catName: string) => {
    if (!confirm(`Möchten Sie die Kategorie "${catName}" wirklich löschen?`)) return;

    try {
      const res = await fetch(`/api/categories?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setMsg(`Kategorie "${catName}" gelöscht.`);
        fetchCategories();
      } else {
        setMsg(`❌ Fehler beim Löschen: ${data.error}`);
      }
    } catch (e: any) {
      setMsg(`❌ Fehler: ${e.message}`);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">🏷️ Kategorien verwalten & bearbeiten</h1>
        <p className="text-slate-500 text-sm mt-1">
          Legen Sie eigene Kategorien an oder bearbeiten Sie Namen, Farben und Beschreibungen bestehender Kategorien.
        </p>
      </div>

      {msg && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm flex items-center justify-between">
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} className="text-slate-400 hover:text-slate-600 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Create New Category Form */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <h3 className="text-base font-bold text-slate-900">➕ Neue eigene Kategorie anlegen</h3>
        <form onSubmit={handleCreateCategory} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Kategoriename *</label>
              <input
                type="text"
                placeholder="z.B. Spa & Wellness, Kurtaxe, Minibar..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Beschreibung (optional)</label>
              <input
                type="text"
                placeholder="Kurze Erläuterung zum Zweck der Kategorie"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Farbe für Diagramme auswählen</label>
            <div className="flex flex-wrap items-center gap-3">
              {defaultColors.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition ${
                    color === c ? 'border-slate-900 scale-110 shadow-md' : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200"
                />
                <span className="text-xs font-mono text-slate-500">{color}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition shadow-xs disabled:opacity-50"
            >
              {submitting ? 'Erstelle...' : 'Kategorie speichern'}
            </button>
          </div>
        </form>
      </div>

      {/* Categories List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Alle Kategorien ({categories.length})</h3>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Lade Kategorien...</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {categories.map((cat) => (
              <div key={cat.id} className="p-5 flex items-center justify-between hover:bg-slate-50/80 transition">
                <div className="flex items-center gap-4 w-2/3">
                  <span className="w-5 h-5 rounded-full shrink-0 shadow-xs" style={{ backgroundColor: cat.color }} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{cat.name}</span>
                      {cat.isHotelCore ? (
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-semibold">
                          Hotel-Standard
                        </span>
                      ) : (
                        <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md font-semibold">
                          Benutzerdefiniert
                        </span>
                      )}
                    </div>
                    {cat.description && (
                      <p className="text-xs text-slate-500 mt-0.5">{cat.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right text-xs text-slate-500">
                    <span className="font-bold text-slate-900 block text-sm">{cat._count?.transactions || 0}</span>
                    <span>Buchungen</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingCategory(cat);
                        setEditName(cat.name);
                        setEditColor(cat.color);
                        setEditDescription(cat.description || '');
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
                    >
                      ✏️ Bearbeiten
                    </button>

                    {!cat.isHotelCore && (
                      <button
                        onClick={() => handleDeleteCategory(cat.id, cat.name)}
                        className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1.5 hover:bg-red-50 rounded-lg transition"
                      >
                        Löschen
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Category Modal */}
      {editingCategory && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">Kategorie bearbeiten</h3>
              <button onClick={() => setEditingCategory(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditCategory} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Kategoriename *</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Beschreibung / Erläuterung</label>
                <textarea
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">Diagramm-Farbe</label>
                <div className="flex flex-wrap items-center gap-2">
                  {defaultColors.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setEditColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition ${
                        editColor === c ? 'border-slate-900 scale-110 shadow-md' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    className="w-7 h-7 rounded-lg cursor-pointer border border-slate-200 ml-1"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingCategory(null)}
                  className="px-4 py-2 text-slate-600 text-sm font-medium hover:bg-slate-100 rounded-xl transition"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={savingEdit || !editName.trim()}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-xs transition disabled:opacity-50"
                >
                  {savingEdit ? 'Speichere...' : 'Änderungen speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
