import React, { useState } from 'react';
import { Youtube, ShoppingBag, Key, Sparkles, Eye, EyeOff, Shield, Sliders, Zap, Bot, Clapperboard } from 'lucide-react';

export default function InputCard({
  formData,
  setFormData,
  onGenerate,
  isLoading,
  settings,
  onOpenSettings
}) {
  const [showApiKey, setShowApiKey] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    onGenerate();
  };

  return (
    <div className="glass-panel rounded-2xl p-6 shadow-xl relative overflow-hidden">
      {/* Decorative gradient blur */}
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <form onSubmit={handleSubmit} className="relative z-10 space-y-5">
        
        {/* Section Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-shopee-500" />
              Source Video & Affiliate Campaign
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Generates Ad Advisor Scene Breakdown, Context, Voiceover Script & 9:16 Video.
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenSettings}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/70 transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-shopee-500" />
            <span>Settings</span>
          </button>
        </div>

        {/* AI Model Selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Bot className="w-4 h-4 text-indigo-400" />
              AI Scripting & Vision Model <span className="text-shopee-500">*</span>
            </span>
            <span className="text-[11px] font-normal text-emerald-400 font-medium">Ad Advisor Powered</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, model: 'gpt-4o-mini' })}
              className={`p-3 rounded-xl border text-left transition-all ${
                (formData.model || 'gpt-4o-mini') === 'gpt-4o-mini'
                  ? 'bg-indigo-950/60 border-indigo-500/80 ring-1 ring-indigo-500/50 text-white'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs font-mono">gpt-4o-mini</span>
                <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-semibold">Recommended</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">
                Scene breakdown, context, and high-converting Ad Advisor voiceover.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setFormData({ ...formData, model: 'gemini-1.5-flash' })}
              className={`p-3 rounded-xl border text-left transition-all ${
                formData.model === 'gemini-1.5-flash'
                  ? 'bg-amber-950/60 border-amber-500/80 ring-1 ring-amber-500/50 text-white'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs font-mono">gemini-1.5-flash</span>
                <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-semibold">Vision Fast</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">
                High-speed visual reasoning via Google Gemini vision endpoint.
              </p>
            </button>
          </div>
        </div>

        {/* YouTube Video URL Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Youtube className="w-4 h-4 text-red-500" />
              YouTube Video URL <span className="text-shopee-500">*</span>
            </span>
            <span className="text-[11px] font-normal text-slate-400">Target video (Reviews, Unboxing, ASMR)</span>
          </label>
          <div className="relative">
            <input
              type="url"
              required
              placeholder="https://www.youtube.com/watch?v=..."
              value={formData.youtubeUrl}
              onChange={(e) => setFormData({ ...formData, youtubeUrl: e.target.value })}
              className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-shopee-500/50 focus:border-shopee-500 transition-all font-mono"
            />
          </div>
        </div>

        {/* Shopee Affiliate Link Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <ShoppingBag className="w-4 h-4 text-shopee-500" />
              Shopee Affiliate Link <span className="text-shopee-500">*</span>
            </span>
            <span className="text-[11px] font-normal text-slate-400">Embedded in AI script & caption</span>
          </label>
          <div className="relative">
            <input
              type="text"
              required
              placeholder="https://shope.ee/abcdef..."
              value={formData.shopeeLink}
              onChange={(e) => setFormData({ ...formData, shopeeLink: e.target.value })}
              className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-shopee-500/50 focus:border-shopee-500 transition-all font-mono"
            />
          </div>
        </div>

        {/* Aivene API Key Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Key className="w-4 h-4 text-amber-400" />
              Aivene API Key <span className="text-shopee-500">*</span>
            </span>
            <span className="text-[11px] font-normal text-slate-400">api.aivene.com</span>
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              required
              placeholder="aivene-xxxxxxxxxxxxxxxxxxxxxxxxx"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              className="w-full bg-slate-900/90 border border-slate-700 rounded-xl pl-4 pr-11 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all font-mono"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 transition-colors"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Applied Filters Strip */}
        <div className="pt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1 text-slate-300 font-medium">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            Active Filters:
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-slate-300">
            9:16 Vertical (720x1280)
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-slate-300">
            Speed: {settings.speedMultiplier}x
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-slate-300">
            {settings.hflip ? 'H-Flip: ON' : 'H-Flip: OFF'}
          </span>
        </div>

        {/* Generate Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-4 rounded-xl font-bold text-base flex items-center justify-center gap-2.5 transition-all shadow-lg ${
              isLoading
                ? 'bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700'
                : 'bg-gradient-to-r from-shopee-500 via-orange-500 to-amber-500 text-white hover:from-shopee-600 hover:to-amber-600 shadow-orange-500/25 hover:shadow-orange-500/40 hover:scale-[1.01] active:scale-[0.99]'
            }`}
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                <span>Generating Scene Breakdown & Video...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 fill-current" />
                <span>Generate Local Clip & Script</span>
              </>
            )}
          </button>
        </div>

      </form>
    </div>
  );
}
