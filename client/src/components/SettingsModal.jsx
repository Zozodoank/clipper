import React from 'react';
import { X, Shield, Sliders, Volume2, Film, RefreshCw, Check, Bot } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose, settings, setSettings }) {
  if (!isOpen) return null;

  const resetDefaults = () => {
    setSettings({
      hflip: false,
      speedMultiplier: 1,
      enableSubtitles: false,
      enableTts: false,
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
              Keep 1.00x for precise 5-second product shots. Higher speeds are optional.
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

          {/* Optional Burn Subtitles */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
            <div>
              <div className="font-semibold text-slate-200">Burn Subtitles on Video</div>
              <p className="text-xs text-slate-400 mt-0.5">
                Burn yellow/white script subtitles directly onto the rendered video frame.
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

          {/* API Endpoint & .env Note */}
          <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-xs text-indigo-300 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold">Aivene Configuration:</span>
              <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">server/.env</span>
            </div>
            <p className="text-[11px] text-slate-400">
              API key dibaca langsung dari file <code className="text-slate-200">.env</code> backend untuk keamanan dan kenyamanan.
            </p>
            <div className="pt-1">
              <code className="bg-slate-900 px-2 py-0.5 rounded font-mono text-[11px] text-indigo-200 block">
                https://api.aivene.com/v1
              </code>
            </div>
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
