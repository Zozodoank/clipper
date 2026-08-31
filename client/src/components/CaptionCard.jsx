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
  Terminal,
  Volume2,
  Clock
} from 'lucide-react';
import { copyToClipboardSafe } from '../utils/clipboard';

/**
 * Parse Google AI Studio prompt into 3 separate sections:
 * 1. Scene Setting
 * 2. Sample Context (Style & Pacing & Voiceover Duration)
 * 3. Speaker / Dialogue (Voiceover with emotion tags)
 */
function parseAiStudioSections(promptText, sampleContext, voiceoverScript, videoDuration) {
  let scene = 'Studio dapur modern yang bersih dengan presenter Indonesia bersuara ramah dan energik.';
  let context = '';
  let speaker = voiceoverScript || '';

  if (typeof promptText === 'string' && promptText.trim().length > 0) {
    const text = promptText.trim();

    // Match Scene section
    const sceneMatch = text.match(/(?:Scene|SCENE)[\s\r\n:]+([\s\S]*?)(?=(?:Sample Context|SAMPLE CONTEXT|Context|Speaker|SPEAKER|$))/i);
    if (sceneMatch && sceneMatch[1].trim()) {
      scene = sceneMatch[1].trim();
    }

    // Match Sample Context section
    const contextMatch = text.match(/(?:Sample Context|SAMPLE CONTEXT|Context)[\s\r\n:]+([\s\S]*?)(?=(?:Speaker|SPEAKER|$))/i);
    if (contextMatch && contextMatch[1].trim()) {
      context = contextMatch[1].trim();
    }

    // Match Speaker section (Speaker 1, Speaker 1 - Orus, etc.)
    const speakerMatch = text.match(/(?:Speaker\s*\d*(?:\s*-\s*[A-Za-z0-9]+)?|SPEAKER\s*\d*)[\s\r\n:]+([\s\S]*)$/i);
    if (speakerMatch && speakerMatch[1].trim()) {
      speaker = speakerMatch[1].trim();
    } else if (!sceneMatch && !contextMatch) {
      speaker = text;
    }
  }

  // Fallback speaker if empty
  if (!speaker && voiceoverScript) {
    speaker = voiceoverScript;
  }

  // Clean any accidental leftover header lines from speaker text
  speaker = speaker.replace(/^Speaker\s*\d*(?:\s*-\s*[A-Za-z0-9]+)?[\s\r\n:]+/i, '').trim();

  // Extract the last timestamp from Speaker 1 (e.g. [00:30] -> 30s)
  const timestampMatches = [...(speaker || '').matchAll(/\[(\d{1,2}):(\d{2})\]/g)];
  let effectiveDuration = null;
  if (timestampMatches.length > 0) {
    const lastMatch = timestampMatches[timestampMatches.length - 1];
    const minutes = parseInt(lastMatch[1], 10);
    const seconds = parseInt(lastMatch[2], 10);
    effectiveDuration = minutes * 60 + seconds;
  }

  if (effectiveDuration === null || effectiveDuration <= 0) {
    effectiveDuration = videoDuration || (sampleContext?.videoDuration ? parseInt(sampleContext.videoDuration, 10) : 30);
  }

  const defaultDurationPrefix = `Durasi voice over ${effectiveDuration} detik. `;

  if (!context) {
    context = `${defaultDurationPrefix}Iklan affiliate viral. Dimulai dengan hook yang menarik perhatian, membangun ke demonstrasi produk, diakhiri CTA yang meyakinkan. Nada suara hangat, antusias, dan persuasif.`;
  } else {
    // Replace existing "Durasi video XX detik" or "Durasi voice over XX detik" or "Durasi XX detik"
    if (/durasi\s+(?:video|voice\s+over)?\s*\d+\s*detik/i.test(context)) {
      context = context.replace(/durasi\s+(?:video|voice\s+over)?\s*\d+\s*detik/i, `Durasi voice over ${effectiveDuration} detik`);
    } else {
      context = `${defaultDurationPrefix}${context}`;
    }
    // Also replace any leftover "durasi video" with "durasi voice over"
    context = context.replace(/durasi\s+video/gi, 'durasi voice over');
  }

  return { scene, context, speaker };
}

export default function CaptionCard({ result }) {
  // 'scenes' | 'script' | 'context' | 'aistudio' | 'caption'
  const [activeTab, setActiveTab] = useState('scenes');
  const [copiedField, setCopiedField] = useState(null);

  if (!result) return null;

  const videoDuration = result.highlight?.duration || (result.sampleContext?.videoDuration ? parseInt(result.sampleContext.videoDuration, 10) : (Array.isArray(result.scenes) && result.scenes.length > 0 ? result.scenes.length * 5 : 30));
  const formattedDuration = result.sampleContext?.videoDuration || `${videoDuration} detik`;

  const copyToClipboard = async (text, fieldName) => {
    await copyToClipboardSafe(text);
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
    ? `Produk: ${result.sampleContext.productName || result.videoTitle}\nDurasi Video: ${formattedDuration}\nTarget Audiens: ${result.sampleContext.targetAudience || '-'}\nMasalah Utama: ${result.sampleContext.coreProblem || '-'}\nKeunggulan Utama:\n${(result.sampleContext.keyFeatures || []).map((f) => `- ${f}`).join('\n')}\nTrigger Pembelian: ${result.sampleContext.buyingTrigger || '-'}`
    : '';

  const aiStudioSections = parseAiStudioSections(result.aiStudioPrompt, result.sampleContext, result.voiceoverScript, videoDuration);
  const fullAiStudioPrompt = `Scene\n${aiStudioSections.scene}\n\nSample Context\n${aiStudioSections.context}\n\nSpeaker 1\n${aiStudioSections.speaker}`;

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
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Studio Prompt (3 Kotak)</span>
          </button>

          {/* Caption Reels Tab */}
          <button
            onClick={() => setActiveTab('caption')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === 'caption'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Caption & Tag</span>
          </button>
        </div>

        {/* Global Copy Button for Active Tab */}
        <button
          onClick={() => {
            if (activeTab === 'scenes') copyToClipboard(scenesText, 'scenes');
            if (activeTab === 'script') copyToClipboard(result.voiceoverScript, 'script');
            if (activeTab === 'context') copyToClipboard(contextText, 'context');
            if (activeTab === 'aistudio') copyToClipboard(fullAiStudioPrompt, 'aistudio');
            if (activeTab === 'caption') copyToClipboard(result.caption, 'caption');
          }}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all active:scale-95 shadow-sm ml-auto"
          title="Salin isi tab yang sedang aktif"
        >
          {copiedField === activeTab ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Tersalin!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>Copy Active Tab</span>
            </>
          )}
        </button>
      </div>

      {/* Tab Contents Area */}
      <div className="flex-1 overflow-y-auto pr-1">
        
        {/* 1. KOTAK SCENE (TIMELINE BREAKDOWN) */}
        {activeTab === 'scenes' && (
          <div className="space-y-3">
            {Array.isArray(result.scenes) && result.scenes.length > 0 ? (
              result.scenes.map((scene) => (
                <div
                  key={scene.sceneNumber || Math.random()}
                  className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 transition-all flex flex-col gap-2 relative group"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-shopee-500/20 text-shopee-400 font-bold text-[11px] border border-shopee-500/30">
                        SCENE {scene.sceneNumber}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">{scene.timeRange}</span>
                    </div>

                    <button
                      onClick={() =>
                        copyToClipboard(
                          `[SCENE ${scene.sceneNumber} (${scene.timeRange})]\nVisual: ${scene.visualDescription}\nVoiceover: "${scene.voiceover}"\nNotes: ${scene.adAdvisorNotes || '-'}`,
                          `scene_${scene.sceneNumber}`
                        )
                      }
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-slate-400 hover:text-white flex items-center gap-1 bg-slate-800 px-2 py-0.5 rounded border border-slate-700"
                    >
                      {copiedField === `scene_${scene.sceneNumber}` ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copy</span>
                    </button>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div>
                      <span className="text-slate-400 font-semibold">Visual Shot: </span>
                      <span className="text-slate-200">{scene.visualDescription}</span>
                    </div>

                    <div className="p-2 rounded-lg bg-slate-900/90 border border-indigo-950/60">
                      <span className="text-indigo-400 font-semibold block mb-0.5">Voiceover Narasi:</span>
                      <p className="text-indigo-100 italic">"{scene.voiceover}"</p>
                    </div>

                    {scene.adAdvisorNotes && (
                      <div className="text-[11px] text-amber-300/90 flex items-start gap-1">
                        <span className="font-semibold text-amber-400">💡 Notes:</span>
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
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <span className="text-slate-400 font-semibold block mb-1">Nama Produk:</span>
                <p className="text-slate-100 font-bold text-sm">
                  {result.sampleContext?.productName || result.videoTitle}
                </p>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 flex items-center gap-1.5 text-indigo-300">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-semibold text-xs">Durasi: {formattedDuration}</span>
              </div>
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

        {/* 4. AI STUDIO / GEMINI PROMPT TEMPLATE (3 KOTAK TERPISAH) */}
        {activeTab === 'aistudio' && (
          <div className="flex-1 flex flex-col space-y-3.5">
            {/* Header Toolbar */}
            <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-900/70 p-2.5 rounded-xl border border-slate-800 flex-wrap gap-2">
              <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Format 3 Blok Google AI Studio (Audio Generation):</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(fullAiStudioPrompt, 'aistudio_all')}
                  className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 border border-slate-700 transition-colors"
                >
                  {copiedField === 'aistudio_all' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedField === 'aistudio_all' ? 'Tersalin Semua!' : 'Copy Semua'}</span>
                </button>
                <a
                  href="https://aistudio.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 rounded-md bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-400 text-[10px] font-semibold flex items-center gap-1 border border-emerald-500/30 transition-colors"
                >
                  <span>Buka AI Studio</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {/* KOTAK 1: SCENE */}
            <div className="rounded-xl bg-slate-950/90 border border-indigo-900/40 p-3.5 flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] flex items-center justify-center font-bold">1</span>
                  <span>Scene (Latar Belakang & Suasana)</span>
                </span>
                <button
                  onClick={() => copyToClipboard(aiStudioSections.scene, 'aistudio_scene')}
                  className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-indigo-600/30 text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 text-[10px] font-semibold flex items-center gap-1 transition-all"
                >
                  {copiedField === 'aistudio_scene' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedField === 'aistudio_scene' ? 'Tersalin!' : 'Copy Scene'}</span>
                </button>
              </div>
              <textarea
                readOnly
                value={aiStudioSections.scene}
                rows={2}
                className="w-full bg-slate-900/70 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500/40 resize-none select-all"
              />
            </div>

            {/* KOTAK 2: SAMPLE CONTEXT */}
            <div className="rounded-xl bg-slate-950/90 border border-amber-900/40 p-3.5 flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-300 text-[10px] flex items-center justify-center font-bold">2</span>
                  <span>Sample Context (Gaya Bicara, Pacing & Nada Iklan)</span>
                </span>
                <button
                  onClick={() => copyToClipboard(aiStudioSections.context, 'aistudio_context')}
                  className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-amber-600/30 text-amber-300 hover:text-amber-200 border border-amber-500/30 text-[10px] font-semibold flex items-center gap-1 transition-all"
                >
                  {copiedField === 'aistudio_context' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedField === 'aistudio_context' ? 'Tersalin!' : 'Copy Context'}</span>
                </button>
              </div>
              <textarea
                readOnly
                value={aiStudioSections.context}
                rows={2}
                className="w-full bg-slate-900/70 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-none select-all"
              />
            </div>

            {/* KOTAK 3: SPEAKER 1 */}
            <div className="rounded-xl bg-slate-950/90 border border-emerald-900/40 p-3.5 flex flex-col space-y-2 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] flex items-center justify-center font-bold">3</span>
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Speaker 1 (Naskah Narasi dengan Timestamp & Emotion Tags)</span>
                </span>
                <button
                  onClick={() => copyToClipboard(aiStudioSections.speaker, 'aistudio_speaker')}
                  className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-emerald-600/30 text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1 transition-all"
                >
                  {copiedField === 'aistudio_speaker' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedField === 'aistudio_speaker' ? 'Tersalin!' : 'Copy Speaker 1'}</span>
                </button>
              </div>
              <textarea
                readOnly
                value={aiStudioSections.speaker}
                rows={6}
                className="w-full flex-1 min-h-[140px] bg-slate-900/70 border border-slate-800 rounded-lg p-2.5 text-xs text-emerald-200 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-emerald-500/40 resize-none select-all"
              />
            </div>
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
