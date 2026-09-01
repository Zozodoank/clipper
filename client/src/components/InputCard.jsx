import React from 'react';
import { Youtube, ShoppingBag, Key, Sparkles, Shield, Sliders, Zap, Tag, AlignLeft } from 'lucide-react';

export default function InputCard({
  formData,
  setFormData,
  onGenerate,
  isLoading,
  settings,
  engineStatus,
  onOpenSettings
}) {
  const isGemini = settings?.aiProvider === 'gemini';
  const selectedProviderReady = isGemini ? Boolean(engineStatus?.geminiKeyConfigured) : Boolean(engineStatus?.qwenKeyConfigured);
  const selectedProviderLabel = isGemini 
    ? `Gemini ${engineStatus?.geminiModel || 'flash'}: ${selectedProviderReady ? '.env Active' : 'Missing in .env'}`
    : `Qwen ${engineStatus?.qwenModel || 'vl-plus'}: ${selectedProviderReady ? '.env Active' : 'Missing in .env'}`;

  const handleSubmit = (e) => {
    e.preventDefault();
    onGenerate();
  };

  return (
    <div className="glass-panel rounded-2xl p-6 shadow-xl relative overflow-hidden">
      {/* Decorative gradient blur */}
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <form onSubmit={handleSubmit} className="relative z-10 space-y-4">
        
        {/* Section Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-shopee-500" />
              Source Video & Informasi Produk
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Masukkan detail produk agar AI menghasilkan naskah yang akurat dan persuasif.
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

        {/* 1. Judul / Nama Produk */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Tag className="w-4 h-4 text-amber-400" />
              Judul / Nama Produk <span className="text-shopee-500">*</span>
            </span>
            <span className="text-[11px] font-normal text-amber-300">Konteks Utama AI</span>
          </label>
          <input
            type="text"
            required
            placeholder="Contoh: Mini Portable Blender USB 350ml Rechargeable"
            value={formData.productTitle || ''}
            onChange={(e) => setFormData({ ...formData, productTitle: e.target.value })}
            className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all font-sans"
          />
        </div>

        {/* 2. Deskripsi & Keunggulan Produk */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <AlignLeft className="w-4 h-4 text-indigo-400" />
              Deskripsi & Spesifikasi Produk (Opsional / Rekomendasi)
            </span>
            <span className="text-[11px] font-normal text-slate-400">Poin penting naskah</span>
          </label>
          <textarea
            rows={3}
            placeholder="Contoh: Kapasitas 350ml, 4 mata pisau stainless steel, baterai tahan 15x pemakaian, waterproof, praktis buat jus & smoothie, mudah dicuci."
            value={formData.productDescription || ''}
            onChange={(e) => setFormData({ ...formData, productDescription: e.target.value })}
            className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all font-sans resize-none"
          />
        </div>

        {/* 3. YouTube Video URL Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Youtube className="w-4 h-4 text-red-500" />
              YouTube Video URL <span className="text-shopee-500">*</span>
            </span>
            <span className="text-[11px] font-normal text-slate-400">Faceless AI Highlight</span>
          </label>
          <input
            type="url"
            required
            placeholder="https://www.youtube.com/watch?v=..."
            value={formData.youtubeUrl}
            onChange={(e) => setFormData({ ...formData, youtubeUrl: e.target.value })}
            className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-shopee-500/50 focus:border-shopee-500 transition-all font-mono"
          />
        </div>

        {/* 4. Shopee Affiliate Link Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <ShoppingBag className="w-4 h-4 text-shopee-500" />
              Shopee Affiliate Link <span className="text-shopee-500">*</span>
            </span>
            <span className="text-[11px] font-normal text-slate-400">CTA di caption & naskah</span>
          </label>
          <input
            type="text"
            required
            placeholder="https://shope.ee/abcdef..."
            value={formData.shopeeLink}
            onChange={(e) => setFormData({ ...formData, shopeeLink: e.target.value })}
            className="w-full bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-shopee-500/50 focus:border-shopee-500 transition-all font-mono"
          />
        </div>

        {/* Applied Filters & .env Status Strip */}
        <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-slate-300 font-medium">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              Active Filters:
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-slate-300">
              9:16 Vertical (1080x1920)
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-slate-300">
              Full Product
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-slate-300">
              Speed: {settings.speedMultiplier}x
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-slate-300">
              {settings.hflip ? 'H-Flip: ON' : 'H-Flip: OFF'}
            </span>
          </div>

          <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full border font-medium text-[10px] ${
            selectedProviderReady
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-amber-500/10 border-amber-500/20 text-amber-300'
          }`}>
            <Key className="w-3 h-3" />
            <span>{selectedProviderLabel}</span>
          </div>
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
                <span>Memproses Tahap 1 (Clipping & Scripting)...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 fill-current" />
                <span>Generate Kotak Scene & Video 9:16</span>
              </>
            )}
          </button>
        </div>

      </form>
    </div>
  );
}
