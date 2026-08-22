import React from 'react';
import { Download, Film, Sparkles, Clapperboard, Layers, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export default function ProgressCard({ progressState }) {
  const { step, message, progress = 0, status, error } = progressState;

  const steps = [
    { id: 'download', label: '1. Download 720p Video', icon: Download, desc: 'yt-dlp engine fetching max 720p' },
    { id: 'frames', label: '2. Frame Extraction', icon: Film, desc: 'FFmpeg sampling 1 frame / 2s & Base64' },
    { id: 'ai_vision', label: '3. Ad Advisor Analysis', icon: Sparkles, desc: 'gpt-4o-mini scene breakdown & script' },
    { id: 'render', label: '4. Anti-Detection 9:16', icon: Layers, desc: '720x1280 crop, 1.03x speed & color shift' },
    { id: 'completed', label: '5. Ready & Complete', icon: CheckCircle2, desc: 'Output MP4, scenes & scripts ready' },
  ];

  const getStepStatus = (stepId, index) => {
    if (status === 'error') {
      if (step === stepId) return 'error';
    }
    if (status === 'completed') return 'completed';

    const stepOrder = ['start', 'download', 'frames', 'ai_vision', 'tts', 'subtitles', 'render', 'cleanup', 'completed'];
    const currentIndex = stepOrder.indexOf(step);
    const thisIndex = stepOrder.indexOf(stepId);

    if (stepId === 'completed') {
      return status === 'completed' ? 'completed' : 'pending';
    }

    if (thisIndex < currentIndex) return 'completed';
    if (thisIndex === currentIndex || (stepId === 'render' && (step === 'subtitles' || step === 'tts'))) return 'current';
    return 'pending';
  };

  return (
    <div className="glass-panel-glow rounded-2xl p-6 shadow-2xl relative overflow-hidden transition-all duration-300">
      
      {/* Header & Percentage */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {status === 'error' ? (
            <div className="w-9 h-9 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
              <AlertCircle className="w-5 h-5" />
            </div>
          ) : status === 'completed' ? (
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-shopee-500/20 border border-shopee-500/30 flex items-center justify-center text-shopee-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          <div>
            <h3 className="text-base font-bold text-white">
              {status === 'completed'
                ? 'Processing Finished!'
                : status === 'error'
                ? 'Generation Failed'
                : 'Ad Advisor & Video Pipeline Running'}
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              {message || 'Executing automated workflow...'}
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-2xl font-black text-white font-mono">{progress}%</span>
        </div>
      </div>

      {/* Main Progress Bar */}
      <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden mb-6 p-0.5 border border-slate-700/50">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            status === 'error'
              ? 'bg-red-500'
              : status === 'completed'
              ? 'bg-emerald-500'
              : 'bg-gradient-to-r from-shopee-500 via-orange-500 to-amber-400 animate-pulse'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Grid of Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {steps.map((s, idx) => {
          const stepStatus = getStepStatus(s.id, idx);
          const Icon = s.icon;

          return (
            <div
              key={s.id}
              className={`p-3 rounded-xl border transition-all flex items-start gap-3 ${
                stepStatus === 'completed'
                  ? 'bg-slate-900/90 border-emerald-500/30 text-slate-200'
                  : stepStatus === 'current'
                  ? 'bg-slate-900/90 border-shopee-500/60 shadow-lg shadow-shopee-500/10 text-white ring-1 ring-shopee-500/40'
                  : stepStatus === 'error'
                  ? 'bg-red-950/30 border-red-500/40 text-red-200'
                  : 'bg-slate-900/40 border-slate-800/80 text-slate-500'
              }`}
            >
              <div
                className={`p-2 rounded-lg mt-0.5 ${
                  stepStatus === 'completed'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : stepStatus === 'current'
                    ? 'bg-shopee-500/20 text-shopee-400 animate-bounce'
                    : stepStatus === 'error'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-slate-800/60 text-slate-600'
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold truncate">{s.label}</span>
                  {stepStatus === 'completed' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  )}
                  {stepStatus === 'current' && (
                    <Loader2 className="w-3.5 h-3.5 text-shopee-400 animate-spin flex-shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">{s.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Error Message Box */}
      {status === 'error' && error && (
        <div className="mt-4 p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-xs font-mono">
          <div className="font-bold flex items-center gap-1.5 mb-1 text-red-400">
            <AlertCircle className="w-4 h-4" />
            Error Details:
          </div>
          <p className="break-all whitespace-pre-wrap">{error}</p>
        </div>
      )}
    </div>
  );
}
