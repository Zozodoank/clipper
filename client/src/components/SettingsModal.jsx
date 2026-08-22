import React from 'react';
import { X, Shield, Sliders, Volume2, Film, RefreshCw, Check } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose, settings, setSettings }) {
  if (!isOpen) return null;

  const voices = [
    { id: 'alloy', name: 'Alloy (Neutral & Clear)' },
    { id: 'nova', name: 'Nova (Warm & Energetic)' },
    { id: 'shimmer', name: 'Shimmer (Bright & Expressive)' },
    { id: 'fable', name: 'Fable (Engaging Narration)' },
    { id: 'echo', name: 'Echo (Smooth & Balanced)' },
    { id: 'onyx', name: 'Onyx (Deep & Authoritative)' },
  ];

  const resetDefaults = () => {
    setSettings({
      hflip: true,
      speedMultiplier: 1.03,
      enableSubtitles: true,
      voice: 'alloy',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-shopee-500" />
            <h3 className="font-bold text-white text-base">Pipeline & Anti-Detection Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-sm">
          
          {/* Horizontal Flip Filter */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
            <div>
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Film className="w-4 h-4 text-shopee-500" />
                <span>Horizontal Flip (hflip)</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Reverses frame orientation to break visual fingerprint matching.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.hflip}
                onChange={(e) => setSettings({ ...settings, hflip: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-shopee-500"></div>
            </label>
          </div>

          {/* Speed Multiplier */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">Video Speed Multiplier</span>
              <span className="font-mono text-xs font-bold text-amber-400 px-2 py-0.5 bg-slate-800 rounded">
                {settings.speedMultiplier}x ({Math.round((1 / settings.speedMultiplier) * 100) / 100} PTS)
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Slightly speeds up frame presentation (1.03x recommended) to evade copyright hash.
            </p>
            <div className="grid grid-cols-4 gap-2 pt-1">
              {[1.00, 1.03, 1.05, 1.08].map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => setSettings({ ...settings, speedMultiplier: spd })}
                  className={`py-1.5 rounded-lg text-xs font-mono font-semibold border transition-all ${
                    settings.speedMultiplier === spd
                      ? 'bg-shopee-500 border-shopee-500 text-white shadow-md shadow-shopee-500/20'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {spd.toFixed(2)}x
                </button>
              ))}
            </div>
          </div>

          {/* Subtitles Burning */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
            <div>
              <div className="font-semibold text-slate-200">Auto-Burn Subtitles</div>
              <p className="text-xs text-slate-400 mt-0.5">
                Renders synchronized yellow/white caption subtitles directly into video.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enableSubtitles}
                onChange={(e) => setSettings({ ...settings, enableSubtitles: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-shopee-500"></div>
            </label>
          </div>

          {/* Voiceover Voice Selection */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Volume2 className="w-4 h-4 text-indigo-400" />
              <span>Voiceover Voice Profile</span>
            </div>
            <select
              value={settings.voice}
              onChange={(e) => setSettings({ ...settings, voice: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-shopee-500"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={resetDefaults}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Reset to Defaults</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-shopee-500 hover:bg-shopee-600 text-white font-bold text-xs transition-colors shadow-md shadow-shopee-500/25"
          >
            Save & Close
          </button>
        </div>

      </div>
    </div>
  );
}
