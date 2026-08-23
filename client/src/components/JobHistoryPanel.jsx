import React, { useEffect, useState } from 'react';
import {
  History, RefreshCw, Trash2, Film, CheckCircle2, AlertCircle,
  Clock, Download, Music, ChevronRight, X, Info, FolderOpen, ExternalLink
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

export default function JobHistoryPanel({ onSelectJob, currentJobId }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

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
  }, []);

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

  const retryableStages = ['error', 'interrupted', 'downloaded'];
  const retryableJobs = jobs.filter(j => retryableStages.includes(j.stage));
  const hasNewItems = retryableJobs.length > 0;

  if (!isOpen) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setIsOpen(true); fetchJobs(); }}
          className={`relative flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
            hasNewItems
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
              : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Riwayat Job & Output</span>
          {hasNewItems && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-500 text-black text-[10px] font-black rounded-full flex items-center justify-center">
              {retryableJobs.length}
            </span>
          )}
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
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60 bg-slate-900/60">
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

      {/* Info banner */}
      {retryableJobs.length > 0 && (
        <div className="mx-4 mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p>
            <strong>{retryableJobs.length} job</strong> dapat di-retry. Job dengan video yang sudah terunduh tidak perlu download ulang.
          </p>
        </div>
      )}

      {/* Job List */}
      <div className="p-4 space-y-2 max-h-[420px] overflow-y-auto">
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

            // Determine button label and style
            const actionConfig = (() => {
              if (job.stage === 'completed') return { label: 'Lihat & Unduh', icon: Download, style: 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' };
              if (job.stage === 'awaiting_voiceover') return { label: 'Lanjut Upload', icon: Music, style: 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30' };
              return { label: 'Retry', icon: RefreshCw, style: 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' };
            })();
            const ActionIcon = actionConfig.icon;

            return (
              <div
                key={job.jobId}
                className={`group relative p-3.5 rounded-xl border transition-all cursor-pointer ${
                  isCurrent
                    ? 'border-shopee-500/50 bg-shopee-500/10 ring-1 ring-shopee-500/30'
                    : isRetryable
                    ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                    : job.stage === 'completed'
                    ? 'border-emerald-500/20 bg-slate-900/60 hover:bg-slate-800/60'
                    : 'border-slate-700/50 bg-slate-900/40 hover:bg-slate-800/40'
                }`}
                onClick={() => onSelectJob(job)}
              >
                <div className="flex items-start justify-between gap-3">
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
                    </div>
                  </div>

                  <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                    {/* Action button - shown for ALL jobs */}
                    <div className="flex items-center gap-1">
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
                    </div>
                    {/* Delete */}
                    <button
                      onClick={(e) => handleDelete(e, job.jobId)}
                      disabled={deletingId === job.jobId}
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
