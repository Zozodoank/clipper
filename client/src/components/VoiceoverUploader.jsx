import React, { useState, useRef, useEffect } from 'react';
import { Upload, Music, Sparkles, CheckCircle2, ArrowRight, ExternalLink, Loader2, FileAudio, FileText, ChevronDown, ChevronUp } from 'lucide-react';

export default function VoiceoverUploader({
  jobId,
  voiceoverScript,
  aiStudioPrompt,
  onUploadSuccess,
  isUploading,
  setIsUploading
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [editableScript, setEditableScript] = useState('');
  const [showScriptEdit, setShowScriptEdit] = useState(false);
  const fileInputRef = useRef(null);

  // Initialize editable script from job voiceoverScript or aiStudioPrompt
  useEffect(() => {
    if (voiceoverScript) {
      setEditableScript(voiceoverScript);
    } else if (aiStudioPrompt) {
      setEditableScript(aiStudioPrompt);
    }
  }, [voiceoverScript, aiStudioPrompt]);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.includes('audio') || file.name.match(/\.(mp3|wav|m4a|aac|ogg)$/i)) {
        setSelectedFile(file);
      } else {
        alert('Please upload an audio file (.mp3, .wav, .m4a)');
      }
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      alert('Silakan pilih file audio voiceover terlebih dahulu.');
      return;
    }

    setIsUploading(true);

    const formData = new FormData();
    formData.append('jobId', jobId);
    formData.append('audio', selectedFile);
    if (editableScript && editableScript.trim()) {
      formData.append('customScript', editableScript.trim());
    }

    try {
      const response = await fetch('/api/upload-voiceover', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to merge voiceover audio.');
      }

      onUploadSuccess(data);
    } catch (err) {
      console.error('Upload failed:', err);
      alert(`Gagal memproses voiceover: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="glass-panel-glow rounded-2xl p-6 shadow-xl border-amber-500/30 relative overflow-hidden">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Music className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>Tahap 2: Upload Voiceover AI Studio</span>
              <span className="text-[10px] uppercase font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                Langkah Terakhir
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Gabungkan audio voiceover dan bakar subtitle sinkron otomatis ke video 9:16.
            </p>
          </div>
        </div>

        <a
          href="https://aistudio.google.com"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-semibold transition-colors bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800"
        >
          <span>Buka Google AI Studio</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Workflow steps reminder */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4 text-[11px] text-slate-300">
        <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2">
          <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center text-[10px]">1</span>
          <span>Copy Naskah / Prompt</span>
        </div>
        <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2">
          <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-[10px]">2</span>
          <span>Generate TTS di AI Studio</span>
        </div>
        <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2">
          <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center text-[10px]">3</span>
          <span>Upload .mp3 di bawah ini</span>
        </div>
      </div>

      {/* Optional: Subtitle Text Verification / Edit Section */}
      <div className="mb-4 rounded-xl bg-slate-950/70 border border-slate-800 p-3">
        <button
          type="button"
          onClick={() => setShowScriptEdit(!showScriptEdit)}
          className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white transition-colors"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span>Naskah Subtitle (Pastikan Sama Persis dengan Suara):</span>
          </span>
          <span className="text-[11px] text-indigo-400 flex items-center gap-1 font-mono">
            <span>{showScriptEdit ? 'Tutup Edit' : 'Lihat / Edit Naskah Subtitle'}</span>
            {showScriptEdit ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        </button>

        {showScriptEdit && (
          <div className="mt-2.5 pt-2.5 border-t border-slate-800/80 space-y-1.5">
            <p className="text-[11px] text-slate-400">
              Jika Anda mengubah kata-kata saat generate di AI Studio, sesuaikan teks di bawah ini agar subtitle yang dibakar sama persis 100% kata-per-kata:
            </p>
            <textarea
              value={editableScript}
              onChange={(e) => setEditableScript(e.target.value)}
              rows={4}
              placeholder="[00:00] Masih repot marut keju..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-y"
            />
          </div>
        )}
      </div>

      {/* Drag and Drop Zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all text-center flex flex-col items-center justify-center ${
          dragActive
            ? 'border-amber-500 bg-amber-500/10'
            : selectedFile
            ? 'border-emerald-500/60 bg-emerald-950/20'
            : 'border-slate-700 hover:border-slate-600 bg-slate-950/60'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a"
          onChange={handleChange}
          className="hidden"
        />

        {selectedFile ? (
          <div className="flex items-center gap-3 text-emerald-300">
            <FileAudio className="w-8 h-8 text-emerald-400 flex-shrink-0" />
            <div className="text-left">
              <p className="font-bold text-xs text-white">{selectedFile.name}</p>
              <p className="text-[10px] text-slate-400">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB &bull; Siap digabungkan
              </p>
            </div>
          </div>
        ) : (
          <div>
            <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-200">
              Klik untuk memilih atau drag & drop file voiceover (.mp3, .wav)
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Audio hasil generate dari Google AI Studio TTS
            </p>
          </div>
        )}
      </div>

      {/* Action Button */}
      <div className="mt-4">
        <button
          onClick={handleUpload}
          disabled={!selectedFile || isUploading}
          className={`w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg ${
            !selectedFile || isUploading
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-emerald-500/25 hover:scale-[1.01] active:scale-[0.99]'
          }`}
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Menggabungkan Audio & Membakar Subtitle...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Gabungkan Voiceover & Bakar Subtitle (Final Video)</span>
            </>
          )}
        </button>
      </div>

    </div>
  );
}
