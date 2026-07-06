import React, { useState } from 'react';
import {
  Layers, Lock, Plus, X, Check,
  Cpu, Cloud, Code, Database, Terminal, Shield, Globe,
  Server, Wifi, Smartphone, Monitor, HardDrive, Layout, Box,
  FileText, BookOpen, GraduationCap, Timer
} from 'lucide-react';

const ICON_MAP: any = {
  Cpu, Cloud, Code, Database, Terminal, Shield, Globe, Lock,
  Server, Wifi, Smartphone, Monitor, HardDrive, Layout, Box,
  FileText, BookOpen, GraduationCap, Timer
};
const ICON_KEYS = Object.keys(ICON_MAP);

interface Mode {
  id: string;
  label: string;
  icon: string;
}

interface ModeSwitcherProps {
  activeMode: string | null;
  setActiveMode: (mode: string | null) => void;
  builtInModes: Mode[];
  customModes: Mode[];
  onCreateMode: (label: string, icon: string) => void;
  allLabel: string;
}

export default function ModeSwitcher({ activeMode, setActiveMode, builtInModes, customModes, onCreateMode, allLabel }: ModeSwitcherProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState('BookOpen');

  const handleCreate = () => {
    if (!newLabel.trim()) return;
    onCreateMode(newLabel.trim(), newIcon);
    setNewLabel('');
    setNewIcon('BookOpen');
    setShowCreate(false);
  };

  const pillClass = (isActive: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
      isActive
        ? 'bg-purple-600 text-white shadow-sm'
        : 'bg-zinc-100 dark:bg-[#23202B] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2A2633]'
    }`;

  return (
    <div className="px-4 pt-4">
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setActiveMode(null)} className={pillClass(activeMode === null)}>
          <Layers size={12} /> {allLabel}
        </button>

        {builtInModes.map(mode => {
          const Icon = ICON_MAP[mode.icon] || BookOpen;
          return (
            <button key={mode.id} onClick={() => setActiveMode(mode.id)} className={pillClass(activeMode === mode.id)}>
              <Icon size={12} /> {mode.label}
            </button>
          );
        })}

        {customModes.map(mode => {
          const Icon = ICON_MAP[mode.icon] || BookOpen;
          return (
            <button
              key={mode.id}
              onClick={() => setActiveMode(mode.id)}
              className={pillClass(activeMode === mode.id)}
              title="Only visible to you"
            >
              <Icon size={12} /> {mode.label} <Lock size={10} className="opacity-60" />
            </button>
          );
        })}

        <button
          onClick={() => setShowCreate(v => !v)}
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-100 dark:bg-[#23202B] text-zinc-400 hover:bg-zinc-200 dark:hover:bg-[#2A2633] hover:text-purple-500 transition-all"
          title="Add custom mode (only visible to you)"
        >
          <Plus size={14} />
        </button>
      </div>

      {showCreate && (
        <div className="mt-2 p-3 bg-zinc-50 dark:bg-[#1C1A24] rounded-xl border border-zinc-200 dark:border-[#2A2633] space-y-2">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
              placeholder="Mode name..."
              className="flex-1 px-2 py-1.5 text-sm bg-white dark:bg-[#23202B] border border-zinc-200 dark:border-[#2A2633] rounded-lg outline-none focus:ring-2 focus:ring-purple-500 dark:text-white"
            />
            <button onClick={handleCreate} className="p-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg"><Check size={14} /></button>
            <button onClick={() => setShowCreate(false)} className="p-1.5 bg-zinc-200 dark:bg-[#2A2633] text-zinc-500 rounded-lg"><X size={14} /></button>
          </div>
          <div className="grid grid-cols-8 gap-1 max-h-[80px] overflow-y-auto">
            {ICON_KEYS.map(key => {
              const Icon = ICON_MAP[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNewIcon(key)}
                  className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${newIcon === key ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300 ring-1 ring-purple-500' : 'bg-white dark:bg-[#18161F] text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#2A2633]'}`}
                >
                  <Icon size={14} />
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-zinc-400 flex items-center gap-1"><Lock size={10} /> Only visible to you</p>
        </div>
      )}
    </div>
  );
}
