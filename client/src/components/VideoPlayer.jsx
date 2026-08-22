import React, { useRef, useState } from 'react';
import { Download, Play, Pause, Volume2, VolumeX, Maximize2, Sparkles, Clock, Check, Folder } from 'lucide-react';

export default function VideoPlayer({ result }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCopiedPath, setIsCopiedPath] = useState(false);

  if (!result || !result.videoUrl) return null;

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    if (videoRef.current.requestFullscreen) {
      videoRef.current.requestFullscreen();
    }
  };

  const copyLocalPath = () => {
    if (result.localPath) {
      navigator.clipboard.writeText(result.localPath);
      setIsCopiedPath(true);
      setTimeout(() => setIsCopiedPath(false), 2000);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-6 shadow-xl flex flex-col items-center">
      
      {/* Header */}
      <div className="w-full flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">9:16 Output Preview</h3>
            <p className="text-xs text-slate-400 font-mono">Anti-detection altered frame</p>
          </div>
        </div>

        {/* Timestamps badge */}
        {result.highlight && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs font-mono text-amber-400">
            <Clock className="w-3.5 h-3.5" />
            <span>{result.highlight.startTime} - {result.highlight.endTime}</span>
            <span className="text-slate-500">({result.highlight.duration}s)</span>
          </div>
        )}
      </div>

      {/* Video Container in 9:16 Portrait Frame */}
      <div className="relative w-full max-w-[320px] aspect-[9/16] bg-black rounded-3xl overflow-hidden border-4 border-slate-800 shadow-2xl shadow-black/80 group">
        
        <video
          ref={videoRef}
          src={result.videoUrl}
          playsInline
          loop
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          className="w-full h-full object-cover cursor-pointer"
          onClick={togglePlay}
        />

        {/* Play / Pause Center Overlay Button */}
        {!isPlaying && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white hover:scale-110 hover:bg-shopee-500 transition-all shadow-xl"
          >
            <Play className="w-7 h-7 fill-white translate-x-0.5" />
          </button>
        )}

        {/* Bottom Video Controls Bar */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} className="text-white hover:text-shopee-400 transition-colors">
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button onClick={toggleMute} className="text-white hover:text-shopee-400 transition-colors">
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
          </div>

          <button onClick={toggleFullscreen} className="text-white hover:text-shopee-400 transition-colors">
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        {/* Anti-Detection Verified Badge */}
        <div className="absolute top-3 left-3 bg-emerald-950/80 backdrop-blur-md border border-emerald-500/40 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          1.03x + Color Shift
        </div>
      </div>

      {/* Download Action Button */}
      <div className="w-full mt-5 space-y-2.5">
        <a
          href={result.downloadUrl || result.videoUrl}
          download={result.filename || 'affiliate_clip.mp4'}
          className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-600/20 hover:scale-[1.01] active:scale-[0.99]"
        >
          <Download className="w-4 h-4" />
          <span>Download 9:16 Video (.mp4)</span>
        </a>

        {/* Local disk path info & copy */}
        {result.localPath && (
          <button
            onClick={copyLocalPath}
            className="w-full py-2 px-3 rounded-lg bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 text-[11px] text-slate-400 hover:text-slate-200 font-mono flex items-center justify-between transition-colors text-left"
            title="Click to copy full local path on disk"
          >
            <span className="truncate flex items-center gap-1.5 max-w-[85%]">
              <Folder className="w-3 h-3 text-slate-500 flex-shrink-0" />
              <span className="truncate">{result.localPath}</span>
            </span>
            <span className="text-[10px] text-shopee-400 font-sans flex items-center gap-1">
              {isCopiedPath ? <Check className="w-3 h-3 text-emerald-400" /> : 'Copy Path'}
            </span>
          </button>
        )}
      </div>

    </div>
  );
}
