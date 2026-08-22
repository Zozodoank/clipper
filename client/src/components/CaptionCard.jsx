import React, { useState } from 'react';
import {
  Copy,
  Check,
  Clapperboard,
  FileText,
  MessageSquare,
  Sparkles,
  Layers,
  HelpCircle,
  ShoppingBag,
  ExternalLink,
  Tag,
  Target,
  Lightbulb,
  Terminal
} from 'lucide-react';

export default function CaptionCard({ result }) {
  // 'scenes' | 'script' | 'context' | 'aistudio' | 'caption'
  const [activeTab, setActiveTab] = useState('scenes');
  const [copiedField, setCopiedField] = useState(null);

  if (!result) return null;

  const copyToClipboard = (text, fieldName) => {
    if (typeof text === 'object') {
      navigator.clipboard.writeText(JSON.stringify(text, null, 2));
    } else {
      navigator.clipboard.writeText(text);
    }
    setCopiedField(fieldName);
    setTimeout(() => {
      setCopiedField(null);
    }, 2000);
  };

  const scenesText = Array.isArray(result.scenes)
    ? result.scenes
        .map(
          (s) =>
            `[SCENE ${s.sceneNumber} (${s.timeRange})]\nVisual: ${s.visualDescription}\nVoiceover: "${s.voiceover}"\nNotes: ${s.adAdvisorNotes || '-'}`
        )
        .join('\n\n')
    : '';

  const contextText = result.sampleContext
    ? `Produk: ${result.sampleContext.productName || result.videoTitle}\nTarget Audiens: ${result.sampleContext.targetAudience || '-'}\nMasalah Utama: ${result.sampleContext.coreProblem || '-'}\nKeunggulan Utama:\n${(result.sampleContext.keyFeatures || []).map((f) => `- ${f}`).join('\n')}\nTrigger Pembelian: ${result.sampleContext.buyingTrigger || '-'}`
    : '';

  return (
    <div className="glass-panel rounded-2xl p-6 shadow-xl flex flex-col h-full">
      
      {/* Tab Navigation Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3.5 mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          
          {/* Kotak Scene Tab */}
          <button
            onClick={() => setActiveTab('scenes')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'scenes'
                ? 'bg-shopee-500 text-white shadow-md shadow-shopee-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Clapperboard className="w-3.5 h-3.5" />
            <span>Kotak Scene</span>
          </button>

          {/* Voiceover Script Tab */}
          <button
            onClick={() => setActiveTab('script')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'script'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Script Voiceover (ID)</span>
          </button>

          {/* Sample Context Tab */}
          <button
            onClick={() => setActiveTab('context')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'context'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            <span>Sample Context</span>
          </button>

          {/* AI Studio / Gemini Prompt Tab */}
          <button
            onClick={() => setActiveTab('aistudio')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'aistudio'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>AI Studio Prompt</span>
          </button>

          {/* Reels Caption Tab */}
          <button
            onClick={() => setActiveTab('caption')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'caption'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Caption & Shopee Link</span>
          </button>

        </div>

        {/* Global Copy Button for Active Tab */}
        <button
          onClick={() => {
            if (activeTab === 'scenes') copyToClipboard(scenesText, 'scenes');
            if (activeTab === 'script') copyToClipboard(result.voiceoverScript, 'script');
            if (activeTab === 'context') copyToClipboard(contextText, 'context');
            if (activeTab === 'aistudio') copyToClipboard(result.aiStudioPrompt, 'aistudio');
            if (activeTab === 'caption') copyToClipboard(result.caption, 'caption');
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors ml-auto"
        >
          {copiedField === activeTab ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>Copy Active Tab</span>
            </>
          )}
        </button>
      </div>

      {/* Visual Hook Banner */}
      {result.productHook && (
        <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-500/20 flex items-center justify-between text-xs text-orange-300">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-orange-400 flex-shrink-0" />
            <span className="font-bold">Ad Advisor Hook:</span>
            <span className="italic">{result.productHook}</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            Model: {result.modelUsed || 'gpt-4o-mini'}
          </span>
        </div>
      )}

      {/* Tab Contents */}
      <div className="flex-1 flex flex-col min-h-[300px]">
        
        {/* 1. KOTAK SCENE BREAKDOWN */}
        {activeTab === 'scenes' && (
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {Array.isArray(result.scenes) && result.scenes.length > 0 ? (
              result.scenes.map((scene, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-colors relative group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black text-shopee-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Clapperboard className="w-3.5 h-3.5" />
                      Scene {scene.sceneNumber || idx + 1}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-400 font-mono text-[11px] font-semibold border border-slate-700">
                      {scene.timeRange}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-slate-400 font-semibold">Visual Cue: </span>
                      <span className="text-slate-200">{scene.visualDescription}</span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 text-emerald-300 font-medium">
                      <span className="text-slate-400 block text-[10px] uppercase tracking-wider mb-0.5">
                        Voiceover Narration:
                      </span>
                      "{scene.voiceover}"
                    </div>

                    {scene.adAdvisorNotes && (
                      <div className="text-[11px] text-indigo-300 flex items-start gap-1">
                        <Lightbulb className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                        <span>{scene.adAdvisorNotes}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400">Tidak ada data kotak scene.</p>
            )}
          </div>
        )}

        {/* 2. VOICEOVER SCRIPT (AD ADVISOR FORMAT) */}
        {activeTab === 'script' && (
          <div className="relative flex-1 flex flex-col">
            <div className="mb-2 text-[11px] text-slate-400 flex items-center gap-1">
              <span>Struktur Ad Advisor:</span>
              <span className="text-indigo-300 font-medium">[HOOK 0-3s] → [DEMO & BENEFIT] → [CTA SHOPEE]</span>
            </div>
            <textarea
              readOnly
              value={result.voiceoverScript}
              rows={13}
              className="w-full flex-1 min-h-[280px] bg-slate-950/90 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none select-all"
            />
          </div>
        )}

        {/* 3. SAMPLE CONTEXT */}
        {activeTab === 'context' && (
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3.5 text-xs">
            <div>
              <span className="text-slate-400 font-semibold block mb-1">Nama Produk:</span>
              <p className="text-slate-100 font-bold text-sm">
                {result.sampleContext?.productName || result.videoTitle}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 font-semibold block mb-1 flex items-center gap-1">
                  <Target className="w-3.5 h-3.5 text-amber-400" />
                  Target Audiens:
                </span>
                <p className="text-slate-200">{result.sampleContext?.targetAudience || '-'}</p>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 font-semibold block mb-1 flex items-center gap-1">
                  <HelpCircle className="w-3.5 h-3.5 text-rose-400" />
                  Masalah Utama (Pain Point):
                </span>
                <p className="text-slate-200">{result.sampleContext?.coreProblem || '-'}</p>
              </div>
            </div>

            {Array.isArray(result.sampleContext?.keyFeatures) && (
              <div>
                <span className="text-slate-400 font-semibold block mb-1.5">Keunggulan Utama (USPs):</span>
                <div className="flex flex-wrap gap-1.5">
                  {result.sampleContext.keyFeatures.map((feat, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-xs font-medium"
                    >
                      ✓ {feat}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.sampleContext?.buyingTrigger && (
              <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-300">
                <span className="font-bold block mb-0.5">Trigger Pembelian (Psychological Hook):</span>
                <span>{result.sampleContext.buyingTrigger}</span>
              </div>
            )}
          </div>
        )}

        {/* 4. AI STUDIO / GEMINI PROMPT TEMPLATE */}
        {activeTab === 'aistudio' && (
          <div className="relative flex-1 flex flex-col">
            <div className="mb-2 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Salin prompt ini ke Google AI Studio / Gemini untuk variasi script manual:</span>
              <a
                href="https://aistudio.google.com"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
              >
                <span>Buka AI Studio</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <textarea
              readOnly
              value={result.aiStudioPrompt}
              rows={13}
              className="w-full flex-1 min-h-[280px] bg-slate-950/90 border border-slate-800 rounded-xl p-4 text-xs text-emerald-200 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-none select-all"
            />
          </div>
        )}

        {/* 5. REELS CAPTION & HASHTAGS */}
        {activeTab === 'caption' && (
          <div className="relative flex-1 flex flex-col">
            <textarea
              readOnly
              value={result.caption}
              rows={13}
              className="w-full flex-1 min-h-[280px] bg-slate-950/90 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 font-sans leading-relaxed focus:outline-none focus:ring-1 focus:ring-rose-500/50 resize-none select-all"
            />
          </div>
        )}

      </div>

      {/* Embedded Shopee Link Quick Access */}
      {result.shopeeLink && (
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-400 truncate max-w-[70%]">
            <ShoppingBag className="w-3.5 h-3.5 text-shopee-500 flex-shrink-0" />
            <span className="truncate font-mono">{result.shopeeLink}</span>
          </div>

          <button
            onClick={() => copyToClipboard(result.shopeeLink, 'shopee')}
            className="text-[11px] text-shopee-400 hover:text-shopee-300 font-semibold flex items-center gap-1"
          >
            {copiedField === 'shopee' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copiedField === 'shopee' ? 'Link Copied' : 'Copy Link'}</span>
          </button>
        </div>
      )}

    </div>
  );
}
