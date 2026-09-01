import React from 'react';
import { X, Shield, Sliders, Volume2, Film, RefreshCw, Check, Bot, Sparkles } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose, settings, setSettings }) {
  if (!isOpen) return null;

  const currentProvider = settings.aiProvider || 'gemini';

  const resetDefaults = () => {
    setSettings({
      aiProvider: 'gemini',
      hflip: false,
      speedMultiplier: 1,
      enableSubtitles: false,
      enableTts: false,
      voice: 'alloy',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-shopee-500" />
            <h3 className="font-bold text-white text-base">Pipeline &amp; AI Engine Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-sm max-h-[80vh] overflow-y-auto">
          
          {/* AI Engine Selection */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5 text-sm">
                <Bot className="w-4 h-4 text-emerald-400" />
                <span>Mesin AI Vision &amp; Scripting</span>
              </span>
              <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                Pilih Engine
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 pt-1">
              
              {/* Option 1: Alibaba Qwen (Default & Only Option) */}
              <button
                type="button"
                onClick={() => setSettings({ ...settings, aiProvider: 'qwen' })}
                className={`p-3 rounded-xl border text-left transition-all relative bg-emerald-950/40 border-emerald-500 text-white shadow-lg shadow-emerald-950/50 ring-1 ring-emerald-500/50`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-emerald-300 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    Alibaba Qwen (DashScope)
                  </span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    DEFAULT (Gratis 1M Token)
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-200 font-semibold mb-1">
                  qwen-vl-plus
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Kekuatan AI dari Alibaba Cloud dengan kuota jutaan token gratis. Sangat optimal untuk membaca frame video.
                </p>
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              </button>

            </div>

            <p className="text-[11px] text-slate-400 pt-1">
              💡 <em>Kunci API (<code className="text-slate-300">QWEN_API_KEY</code>) tersimpan aman di berkas <code className="text-slate-300 font-mono">server/.env</code>.</em>
            </p>
          </div>

          {/* Horizontal Flip Filter */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
            <div>
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Film className="w-4 h-4 text-shopee-500" />
                <span>Horizontal Flip (hflip)</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Reverses frame orientation for anti-detection. (Otomatis dinonaktifkan AI jika produk memiliki merek/logo).
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
            className="px-5 py-2 rounded-xl bg-shopee-500 hover:bg-shopee-600 text-white font-bold text-xs transition-colors shadow-md shadow-shopee-500/25"
          >
            Save &amp; Close
          </button>
        </div>

      </div>
    </div>
  );
}
