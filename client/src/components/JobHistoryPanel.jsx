import React, { useEffect, useState, useRef } from 'react';
import {
  History, RefreshCw, Trash2, Film, CheckCircle2, AlertCircle,
  Clock, Download, Music, ChevronRight, X, Info, FolderOpen, ExternalLink,
  Sparkles, Volume2, AlertTriangle, Loader2
} from 'lucide-react';

const STAGE_CONFIG = {
  completed:          { label: 'Selesai (Final Video)', color: 'emerald', icon: CheckCircle2 },
  awaiting_voiceover: { label: 'Menunggu Voiceover', color: 'amber', icon: Music },
  error:              { label: 'Gagal (Dapat Retry)', color: 'red', icon: AlertCircle },
  interrupted:        { label: 'Terputus (Video Tersimpan)', color: 'orange', icon: AlertCircle },
  downloaded:         { label: 'Video Terunduh', color: 'blue', icon: Film },
  running:            { label: 'Sedang Berjalan', color: 'indigo', icon: RefreshCw },
  unknown:            { label: 'Tidak Diketahui', color: 'slate', icon: Clock },
};

function StageBadge({ stage }) {
  const cfg = STAGE_CONFIG[stage] || STAGE_CONFIG.unknown;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-${cfg.color}-500/20 text-${cfg.color}-300 border border-${cfg.color}-500/30`}>
      <Icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  );
}

export default function JobHistoryPanel({ onSelectJob, currentJobId, refreshSignal = 0 }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // TTS processing state
  const [processingTtsId, setProcessingTtsId] = useState(null);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const cancelBatchRef = useRef(false);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (err) {
      console.warn('Could not fetch job history:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [refreshSignal]);

  const handleOpenFolder = async (e, filename) => {
    e.stopPropagation();
    try {
      await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filename ? { filename } : {}),
      });
    } catch (err) {
      console.warn('Could not open folder:', err);
    }
  };

  const handleDelete = async (e, jobId) => {
    e.stopPropagation();
    if (!confirm('Hapus job dan file terkait dari riwayat?')) return;
    setDeletingId(jobId);
    try {
      await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      setJobs(prev => prev.filter(j => j.jobId !== jobId));
    } catch (err) {
      console.warn('Could not delete job:', err.message);
    } finally {
      setDeletingId(null);
    }
  };

  // 1. Single-Job Generate TTS & Merge Video via Fish Audio
  const handleGenerateTTSForJob = async (e, job) => {
    e.stopPropagation();
    if (processingTtsId || batchProcessing) return;

    setProcessingTtsId(job.jobId);
    try {
      const res = await fetch('/api/regenerate-voiceover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.jobId }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.isQuotaError || res.status === 402) {
          alert('⚠️ Kuota harian Fish Audio S2.1 Pro telah habis. Proses dihentikan dan dapat di-retry besok ketika kuota direset.');
        } else {
          alert(`Gagal membuat TTS: ${data.error || 'Terjadi kesalahan pada server.'}`);
        }
        return;
      }

      // Update in state
      setJobs(prev => prev.map(j => j.jobId === job.jobId ? { ...j, ...data, stage: 'completed', hasFinalVideo: true } : j));

      // Auto-select this completed job so user can see it right away
      if (onSelectJob) {
        onSelectJob({ ...job, ...data, stage: 'completed', hasFinalVideo: true });
      }
    } catch (err) {
      console.error('Error generating TTS:', err);
      alert(`Gagal: ${err.message}`);
    } finally {
      setProcessingTtsId(null);
    }
  };

  // 2. Batch Generate TTS for ALL awaiting jobs
  const handleCancelBatch = (e) => {
    e.stopPropagation();
    cancelBatchRef.current = true;
  };

  const handleBatchGenerateTTS = async (e) => {
    e.stopPropagation();
    const awaitingJobs = jobs.filter(j => j.stage === 'awaiting_voiceover');
    if (awaitingJobs.length === 0) return;

    if (!confirm(`Generate TTS otomatis untuk ${awaitingJobs.length} job yang menunggu dengan Fish Audio (ANGELICA)?\n\nSistem akan membuat suara dan menyatukan video satu per satu secara berurutan.`)) {
      return;
    }

    setBatchProcessing(true);
    setBatchTotal(awaitingJobs.length);
    cancelBatchRef.current = false;
    let successCount = 0;

    for (let i = 0; i < awaitingJobs.length; i++) {
      if (cancelBatchRef.current) {
        break;
      }
      const job = awaitingJobs[i];
      setBatchIndex(i);
      setProcessingTtsId(job.jobId);

      try {
        const res = await fetch('/api/regenerate-voiceover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: job.jobId }),
        });
        const data = await res.json();

        if (data.success) {
          successCount++;
          setJobs(prev => prev.map(j => j.jobId === job.jobId ? { ...j, ...data, stage: 'completed', hasFinalVideo: true } : j));
        } else if (data.isQuotaError || res.status === 402) {
          alert(`⚠️ Kuota Fish Audio S2.1 Pro telah habis setelah menyelesaikan ${successCount} job. Sisanya dapat dilanjutkan besok ketika kuota direset.`);
          break;
        }
      } catch (err) {
        console.error(`Error processing job ${job.jobId}:`, err);
      }
    }

    setBatchProcessing(false);
    setProcessingTtsId(null);
    fetchJobs();
  };

  const retryableStages = ['error', 'interrupted', 'downloaded'];
  const retryableJobs = jobs.filter(j => retryableStages.includes(j.stage));
  const awaitingVoiceoverJobs = jobs.filter(j => j.stage === 'awaiting_voiceover');
  const hasNewItems = retryableJobs.length > 0 || awaitingVoiceoverJobs.length > 0;

  if (!isOpen) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setIsOpen(true); fetchJobs(); }}
          className={`relative flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
            awaitingVoiceoverJobs.length > 0
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
              : hasNewItems
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
              : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Riwayat Job & Output</span>
          {awaitingVoiceoverJobs.length > 0 ? (
            <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-emerald-500 text-black text-[10px] font-black rounded-full flex items-center justify-center">
              {awaitingVoiceoverJobs.length}
            </span>
          ) : retryableJobs.length > 0 ? (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-500 text-black text-[10px] font-black rounded-full flex items-center justify-center">
              {retryableJobs.length}
            </span>
          ) : null}
        </button>

        <button
          onClick={(e) => handleOpenFolder(e)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-700/60 bg-slate-800/80 text-amber-400 hover:text-amber-300 hover:bg-slate-800 text-xs font-semibold transition-all"
          title="Buka folder output video di Windows Explorer"
        >
          <FolderOpen className="w-4 h-4" />
          <span className="hidden sm:inline">Buka Folder Output</span>
        </button>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl shadow-2xl overflow-hidden border border-slate-700/60">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60 bg-slate-900/60 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-white">Riwayat Job & Video Output</h3>
          <span className="text-[11px] text-slate-400">({jobs.length} job)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => handleOpenFolder(e)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-colors"
            title="Buka folder output di Windows Explorer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Buka Folder</span>
          </button>
          <button
            onClick={fetchJobs}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Banner 1: Awaiting Voiceover Batch Action */}
      {awaitingVoiceoverJobs.length > 0 && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-gradient-to-r from-emerald-950/60 via-slate-900/80 to-teal-950/60 border border-emerald-500/40 text-xs flex items-center justify-between flex-wrap gap-2 shadow-lg shadow-emerald-950/20 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 flex-shrink-0">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <div className="font-bold text-white flex items-center gap-1.5">
                <span>{awaitingVoiceoverJobs.length} Job Menunggu Voiceover</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30">
                  Fish Audio ANGELICA
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                {batchProcessing
                  ? `Sedang memproses ${batchIndex + 1} dari ${batchTotal} job...`
                  : 'Video 9:16 sudah selesai dipotong. Siap digabungkan dengan suara AI & subtitle.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {batchProcessing ? (
              <button
                type="button"
                onClick={handleCancelBatch}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-xs font-bold transition-all"
              >
                Hentikan Proses
              </button>
            ) : (
              <button
                type="button"
                onClick={handleBatchGenerateTTS}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-400 hover:from-emerald-400 hover:to-teal-300 text-white text-xs font-bold shadow-md shadow-emerald-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Proses Semua ({awaitingVoiceoverJobs.length} Job)</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Banner 2: Retryable failed jobs */}
      {retryableJobs.length > 0 && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p>
            <strong>{retryableJobs.length} job</strong> dapat di-retry. Job dengan video yang sudah terunduh tidak perlu download ulang.
          </p>
        </div>
      )}

      {/* Job List */}
      <div className="p-4 space-y-2.5 max-h-[440px] overflow-y-auto">
        {loading ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
            Memuat riwayat job...
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            <History className="w-6 h-6 mx-auto mb-2 opacity-40" />
            Belum ada riwayat job.
          </div>
        ) : (
          jobs.map((job) => {
            const isRetryable = retryableStages.includes(job.stage);
            const isCurrent = job.jobId === currentJobId;
            const isAwaitingVoiceover = job.stage === 'awaiting_voiceover';
            const isProcessingThis = processingTtsId === job.jobId;

            // Determine button label and style
            const actionConfig = (() => {
              if (job.stage === 'completed') return { label: 'Lihat & Unduh', icon: Download, style: 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' };
              if (isAwaitingVoiceover) return { label: 'Lanjut Upload', icon: Music, style: 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30' };
              return { label: 'Retry', icon: RefreshCw, style: 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' };
            })();
            const ActionIcon = actionConfig.icon;

            return (
              <div
                key={job.jobId}
                className={`group relative p-3.5 rounded-xl border transition-all cursor-pointer ${
                  isCurrent
                    ? 'border-shopee-500/50 bg-shopee-500/10 ring-1 ring-shopee-500/30'
                    : isAwaitingVoiceover
                    ? 'border-emerald-500/30 bg-emerald-950/10 hover:bg-emerald-950/20 ring-1 ring-emerald-500/20'
                    : isRetryable
                    ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                    : job.stage === 'completed'
                    ? 'border-emerald-500/20 bg-slate-900/60 hover:bg-slate-800/60'
                    : 'border-slate-700/50 bg-slate-900/40 hover:bg-slate-800/40'
                }`}
                onClick={() => onSelectJob(job)}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                  <div className="flex-1 min-w-0">
                    {/* Title */}
                    <p className="text-xs font-bold text-slate-200 truncate">
                      {job.productTitle || <span className="text-slate-500 italic">Judul tidak tersimpan</span>}
                    </p>
                    {/* Job ID & date */}
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      ID: {job.jobId}
                      {job.createdAt && ` · ${new Date(job.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}`}
                    </p>
                    {/* Stage badge */}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <StageBadge stage={job.stage} />
                      {job.hasDownloadedVideo && (
                        <span className="text-[10px] text-blue-400 font-semibold bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
                          📥 Video Tersimpan
                        </span>
                      )}
                      {job.hasSilentClip && (
                        <span className="text-[10px] text-purple-400 font-semibold bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                          🎬 9:16 Clip Ready
                        </span>
                      )}
                      {isAwaitingVoiceover && (
                        <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                          ✨ Siap TTS ANGELICA
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                    <div className="flex items-center gap-1.5">
                      {/* If awaiting voiceover, show primary Generate TTS AI button */}
                      {isAwaitingVoiceover ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isProcessingThis || batchProcessing}
                            onClick={(e) => handleGenerateTTSForJob(e, job)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md ${
                              isProcessingThis
                                ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed'
                                : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98]'
                            }`}
                            title="Generate suara ANGELICA & satukan subtitle ke video final secara otomatis"
                          >
                            {isProcessingThis ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                <span>Memproses...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
                                <span>Generate TTS</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800/90 hover:bg-slate-700 text-purple-300 border border-purple-500/30 transition-all"
                            title="Upload audio sendiri secara manual"
                            onClick={(e) => { e.stopPropagation(); onSelectJob(job); }}
                          >
                            <Music className="w-3 h-3" />
                            <span className="hidden xl:inline">Manual</span>
                          </button>
                        </div>
                      ) : (
                        <>
                          {job.stage === 'completed' && (
                            <button
                              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors"
                              title="Buka file ini di Windows Explorer"
                              onClick={(e) => handleOpenFolder(e, job.finalFileName || `final_clip_${job.jobId}.mp4`)}
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${actionConfig.style}`}
                            onClick={(e) => { e.stopPropagation(); onSelectJob(job); }}
                          >
                            <ActionIcon className="w-3 h-3" />
                            {actionConfig.label}
                          </button>
                        </>
                      )}
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={(e) => handleDelete(e, job.jobId)}
                      disabled={deletingId === job.jobId || isProcessingThis}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      {deletingId === job.jobId
                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                        : <Trash2 className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
