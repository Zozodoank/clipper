import React from 'react';
import { Video, Sparkles, Settings, Cpu, ShieldCheck } from 'lucide-react';

export default function Navbar({ onOpenSettings, engineStatus }) {
  return (
    <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-shopee-500 via-orange-500 to-amber-400 flex items-center justify-center shadow-lg shadow-shopee-500/25">
              <Video className="w-5 h-5 text-white stroke-[2.5]" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-slate-900 flex items-center justify-center" title="Local Processing Engine Online">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg text-white tracking-tight">
                Local AI Affiliate Clipper
              </h1>
              <span className="bg-gradient-to-r from-orange-500/20 to-amber-500/20 border border-orange-500/30 text-orange-400 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full">
                9:16 Reels Engine
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Auto-generate viral Shopee Affiliate clips via Aivene AI & FFmpeg
            </p>
          </div>
        </div>

        {/* Right side stats & settings */}
        <div className="flex items-center gap-3">
          {/* AI Model Badge */}
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Aivene</span>
            <span className="text-slate-500">|</span>
            <span className="text-indigo-400 font-mono">gemini-1.5-flash</span>
          </div>

          {/* Anti-detection badge */}
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Anti-Detection Active</span>
          </div>

          {/* Settings Button */}
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm font-medium transition-colors"
            title="Configure anti-detection & rendering settings"
          >
            <Settings className="w-4 h-4 text-slate-400" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>

      </div>
    </header>
  );
}
