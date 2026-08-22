import React, { useState } from 'react';
import { Copy, Check, FileText, MessageSquare, ShoppingBag, Sparkles, Tag } from 'lucide-react';

export default function CaptionCard({ result }) {
  const [activeTab, setActiveTab] = useState('caption'); // 'caption' | 'script'
  const [copiedField, setCopiedField] = useState(null);

  if (!result) return null;

  const copyToClipboard = (text, fieldName) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => {
      setCopiedField(null);
    }, 2000);
  };

  return (
    <div className="glass-panel rounded-2xl p-6 shadow-xl flex flex-col h-full">
      
      {/* Tab Switcher & Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('caption')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'caption'
                ? 'bg-shopee-500 text-white shadow-md shadow-shopee-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Reels Caption & Tags</span>
          </button>

          <button
            onClick={() => setActiveTab('script')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'script'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Voiceover Script (ID)</span>
          </button>
        </div>

        {/* Copy Active Content Button */}
        <button
          onClick={() => {
            const content = activeTab === 'caption' ? result.caption : result.voiceoverScript;
            copyToClipboard(content, activeTab);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors"
        >
          {copiedField === activeTab ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>Copy {activeTab === 'caption' ? 'Caption' : 'Script'}</span>
            </>
          )}
        </button>
      </div>

      {/* Product Hook Banner */}
      {result.productHook && (
        <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-500/20 flex items-center gap-2 text-xs text-orange-300">
          <Sparkles className="w-4 h-4 text-orange-400 flex-shrink-0" />
          <span className="font-bold">Visual Hook:</span>
          <span className="italic">{result.productHook}</span>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 flex flex-col">
        {activeTab === 'caption' ? (
          <div className="relative flex-1">
            <textarea
              readOnly
              value={result.caption}
              rows={12}
              className="w-full h-full min-h-[260px] bg-slate-950/80 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 font-sans leading-relaxed focus:outline-none focus:ring-1 focus:ring-shopee-500/50 resize-none select-all"
            />
          </div>
        ) : (
          <div className="relative flex-1">
            <textarea
              readOnly
              value={result.voiceoverScript}
              rows={12}
              className="w-full h-full min-h-[260px] bg-slate-950/80 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 font-sans leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none select-all"
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
