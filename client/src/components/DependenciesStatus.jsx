import React from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Cpu, HardDrive } from 'lucide-react';

export default function DependenciesStatus({ status, onRefresh, loading }) {
  if (!status) return null;

  const ffmpegOk = status?.dependencies?.ffmpeg?.available || status?.ffmpeg?.available;
  const ytdlpOk = status?.dependencies?.ytdlp?.available || status?.ytdlp?.available;
  const qwenOk = status?.qwenKeyConfigured;
  const qwenModel = status?.qwenModel || 'qwen-vl-plus';
  const geminiOk = status?.geminiKeyConfigured;
  const isGemini = status?.activeAiEngine === 'gemini';
  const engineOk = isGemini ? geminiOk : qwenOk;

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-slate-400 font-medium flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-slate-500" />
          Local Engines:
        </span>

        {/* FFmpeg status */}
        <div className="flex items-center gap-1.5">
          {ffmpegOk ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span className="text-slate-300 font-mono">FFmpeg</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${ffmpegOk ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
            {ffmpegOk ? 'Ready' : 'Not Detected'}
          </span>
        </div>

        {/* yt-dlp status */}
        <div className="flex items-center gap-1.5">
          {ytdlpOk ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span className="text-slate-300 font-mono">yt-dlp</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${ytdlpOk ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
            {ytdlpOk ? 'Ready' : 'Auto-Download Ready'}
          </span>
        </div>

        <span className="text-slate-500">|</span>

        {/* Active Engine */}
        <div className="flex items-center gap-1.5">
          {engineOk ? (
            <CheckCircle2 className={`w-3.5 h-3.5 ${isGemini ? 'text-indigo-400' : 'text-emerald-400'}`} />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span className="text-slate-300 font-mono font-medium">
            {isGemini ? `Gemini (${status?.geminiModel || 'flash'})` : `Qwen (${qwenModel})`}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
            engineOk 
              ? (isGemini ? 'bg-indigo-500/10 text-indigo-400' : 'bg-emerald-500/10 text-emerald-400')
              : 'bg-amber-500/10 text-amber-400'
          }`}>
            {engineOk ? 'Active' : 'Missing in .env'}
          </span>
        </div>
      </div>

      <button
        onClick={onRefresh}
        disabled={loading}
        className="text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors ml-auto"
        title="Check Engine Status"
      >
        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        <span>Check</span>
      </button>
    </div>
  );
}
