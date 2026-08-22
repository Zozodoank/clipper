import React, { useState, useEffect, useRef } from 'react';
import Navbar from './components/Navbar';
import DependenciesStatus from './components/DependenciesStatus';
import InputCard from './components/InputCard';
import ProgressCard from './components/ProgressCard';
import VideoPlayer from './components/VideoPlayer';
import CaptionCard from './components/CaptionCard';
import SettingsModal from './components/SettingsModal';
import { Sparkles, Video, ShieldCheck, Zap, Layers, RefreshCw, Clapperboard } from 'lucide-react';

export default function App() {
  // Form State (persisting API key in localStorage for convenience)
  const [formData, setFormData] = useState(() => ({
    youtubeUrl: '',
    shopeeLink: '',
    apiKey: localStorage.getItem('AIVENE_API_KEY') || '',
    model: 'gemini-2.5-flash',
  }));

  // Anti-Detection & Pipeline Settings
  const [settings, setSettings] = useState({
    hflip: true,
    speedMultiplier: 1.03,
    enableSubtitles: false,
    enableTts: false,
    voice: 'alloy',
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Live Progress & Results State
  const [progressState, setProgressState] = useState({
    step: 'idle',
    message: '',
    progress: 0,
    status: 'idle',
    error: null,
  });

  const [result, setResult] = useState(null);
  const [engineStatus, setEngineStatus] = useState(null);
  const [checkingEngine, setCheckingEngine] = useState(false);

  const eventSourceRef = useRef(null);

  // Save API key to localStorage when updated
  useEffect(() => {
    if (formData.apiKey) {
      localStorage.setItem('AIVENE_API_KEY', formData.apiKey);
    }
  }, [formData.apiKey]);

  // Check Engine Health on Load
  const fetchEngineHealth = async () => {
    setCheckingEngine(true);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setEngineStatus(data);
      }
    } catch (err) {
      console.warn('Could not fetch backend health:', err.message);
    } finally {
      setCheckingEngine(false);
    }
  };

  useEffect(() => {
    fetchEngineHealth();
  }, []);

  // Main Pipeline Trigger
  const handleGenerate = async () => {
    if (!formData.youtubeUrl) {
      alert('Please enter a YouTube video URL.');
      return;
    }
    if (!formData.shopeeLink) {
      alert('Please enter your Shopee Affiliate link.');
      return;
    }
    if (!formData.apiKey) {
      alert('Please enter your Aivene API Key.');
      return;
    }

    setIsLoading(true);
    setResult(null);
    const jobId = Math.random().toString(36).substring(2, 10);

    setProgressState({
      step: 'start',
      message: 'Initializing Gemini 2.5 Flash Vision & Video Engine...',
      progress: 5,
      status: 'running',
      error: null,
    });

    // Start SSE stream for real-time progress updates
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const sse = new EventSource(`/api/progress/${jobId}`);
    eventSourceRef.current = sse;

    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setProgressState((prev) => ({
          ...prev,
          step: data.step || prev.step,
          message: data.message || prev.message,
          progress: data.progress !== undefined ? data.progress : prev.progress,
          status: data.status || prev.status,
          error: data.error || null,
        }));

        if (data.status === 'completed' && data.result) {
          setResult(data.result);
          setIsLoading(false);
          sse.close();
        } else if (data.status === 'error') {
          setIsLoading(false);
          sse.close();
        }
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    };

    sse.onerror = () => {
      sse.close();
    };

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobId,
          youtubeUrl: formData.youtubeUrl,
          shopeeLink: formData.shopeeLink,
          apiKey: formData.apiKey,
          model: formData.model || 'gemini-2.5-flash',
          options: settings,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate affiliate clip.');
      }

      setResult(data);
      setProgressState({
        step: 'completed',
        message: 'Generation complete! Kotak Scene, Ad Advisor Script, and 9:16 Video ready.',
        progress: 100,
        status: 'completed',
        error: null,
      });
    } catch (err) {
      console.error('Generation request failed:', err);
      setProgressState({
        step: 'error',
        message: err.message || 'Generation failed.',
        progress: 0,
        status: 'error',
        error: err.message,
      });
    } finally {
      setIsLoading(false);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080d1a] text-slate-100">
      
      {/* Top Navbar */}
      <Navbar
        onOpenSettings={() => setIsSettingsOpen(true)}
        engineStatus={engineStatus}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Engine dependencies status bar */}
        <DependenciesStatus
          status={engineStatus}
          onRefresh={fetchEngineHealth}
          loading={checkingEngine}
        />

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Column: Form & Live Pipeline Progress (6 cols on lg) */}
          <div className="lg:col-span-6 space-y-6">
            <InputCard
              formData={formData}
              setFormData={setFormData}
              onGenerate={handleGenerate}
              isLoading={isLoading}
              settings={settings}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />

            {(isLoading || progressState.status !== 'idle') && (
              <ProgressCard progressState={progressState} />
            )}
          </div>

          {/* Right Column: Video Preview, Scene Breakdown & Scripts (6 cols on lg) */}
          <div className="lg:col-span-6 space-y-6">
            {result ? (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* 9:16 Video Player & Direct Download Button */}
                <VideoPlayer result={result} />

                {/* Ad Advisor Kotak Scene, Context, Voiceover Script & AI Studio Prompt */}
                <CaptionCard result={result} />
              </div>
            ) : (
              /* Idle Empty State Showcase */
              <div className="glass-panel rounded-2xl p-8 text-center flex flex-col items-center justify-center min-h-[480px] border-dashed border-slate-800">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-shopee-500/20 via-orange-500/20 to-amber-500/20 border border-shopee-500/30 flex items-center justify-center text-shopee-500 mb-4 shadow-xl">
                  <Clapperboard className="w-8 h-8 stroke-[1.75]" />
                </div>

                <h3 className="text-lg font-bold text-white mb-2">
                  Ready to Generate Ad Advisor Clip
                </h3>
                <p className="text-xs text-slate-400 max-w-md leading-relaxed mb-6">
                  Input link YouTube dan link Shopee Affiliate Anda di sebelah kiri. Model <strong className="text-amber-400 font-mono">gemini-2.5-flash</strong> akan menganalisis visual frame untuk membuat <strong className="text-slate-200">Kotak Scene</strong>, <strong className="text-slate-200">Sample Context</strong>, <strong className="text-slate-200">Script Voice Over (Ad Advisor)</strong>, serta merender video vertikal 9:16 anti-detection.
                </p>

                {/* Feature highlight badges */}
                <div className="grid grid-cols-2 gap-3 w-full max-w-sm text-left">
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
                    <div className="font-bold text-slate-200 flex items-center gap-1.5 mb-1">
                      <Clapperboard className="w-3.5 h-3.5 text-shopee-400" />
                      <span>Kotak Scene AI</span>
                    </div>
                    <p className="text-[11px] text-slate-400">Scene breakdown + visual cues + spoken narration</p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
                    <div className="font-bold text-slate-200 flex items-center gap-1.5 mb-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>AI Studio Prompt</span>
                    </div>
                    <p className="text-[11px] text-slate-400">Siap copy-paste ke Gemini / Google AI Studio</p>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
      />

      {/* Footer */}
      <footer className="border-t border-slate-800/60 py-4 bg-slate-950/40 text-center text-xs text-slate-500">
        <p>Local AI Affiliate Clipper &bull; React + Node.js + FFmpeg + Aivene AI (gemini-2.5-flash / gpt-4o-mini) &bull; Ad Advisor Standard</p>
      </footer>

    </div>
  );
}
