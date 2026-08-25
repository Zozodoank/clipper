import { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function CookiesUploader() {
  const [status, setStatus] = useState(null); // null | {exists, sizeBytes}
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/cookies-status`);
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage('');
    setError('');

    try {
      const content = await file.text();
      const res = await fetch(`${API_BASE}/api/upload-cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: content,
      });
      const data = await res.json();
      if (data.success) {
        setMessage('✅ ' + data.message);
        checkStatus();
      } else {
        setError('❌ ' + data.error);
      }
    } catch (err) {
      setError('❌ Upload gagal: ' + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const cookiesOk = status?.exists && status.sizeBytes > 100;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: `1.5px solid ${cookiesOk ? '#22c55e44' : '#f59e0b44'}`,
      borderRadius: '14px',
      padding: '16px 20px',
      marginBottom: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <span style={{ fontSize: '20px' }}>{cookiesOk ? '🍪' : '⚠️'}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: '14px', color: cookiesOk ? '#4ade80' : '#fbbf24' }}>
            {cookiesOk ? 'YouTube Cookies Aktif' : 'YouTube Cookies Dibutuhkan'}
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
            {cookiesOk
              ? `cookies.txt tersimpan (${(status.sizeBytes / 1024).toFixed(1)} KB) — YouTube download siap`
              : 'Server berjalan di cloud (Codespace). YouTube memblokir IP datacenter. Upload cookies.txt agar bisa download.'}
          </div>
        </div>
        <button
          onClick={checkStatus}
          title="Refresh status"
          style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: '16px', padding: '4px'
          }}
        >↻</button>
      </div>

      {!cookiesOk && (
        <div style={{
          fontSize: '12px', color: 'rgba(255,255,255,0.6)',
          background: 'rgba(245,158,11,0.08)', borderRadius: '8px',
          padding: '10px 12px', marginBottom: '12px', lineHeight: '1.7'
        }}>
          <b>Cara mendapatkan cookies.txt:</b><br />
          1. Install ekstensi Chrome: <b>"Get cookies.txt LOCALLY"</b><br />
          2. Buka <b>youtube.com</b> dan pastikan sudah login<br />
          3. Klik ikon ekstensi → Klik <b>"Export"</b> → Simpan file<br />
          4. Upload file di bawah ini ↓
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background: cookiesOk ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.2)',
          border: `1px solid ${cookiesOk ? '#22c55e66' : '#f59e0b66'}`,
          borderRadius: '8px', padding: '8px 14px',
          cursor: uploading ? 'not-allowed' : 'pointer',
          color: cookiesOk ? '#4ade80' : '#fbbf24',
          fontSize: '13px', fontWeight: 600, transition: 'all 0.2s'
        }}>
          {uploading ? '⏳ Mengupload...' : cookiesOk ? '🔄 Perbarui cookies.txt' : '📂 Upload cookies.txt'}
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            style={{ display: 'none' }}
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>

        {cookiesOk && (
          <span style={{ fontSize: '12px', color: '#4ade80' }}>
            ✓ Siap digunakan
          </span>
        )}
      </div>

      {message && (
        <div style={{
          marginTop: '10px', fontSize: '12px', color: '#4ade80',
          background: 'rgba(34,197,94,0.1)', borderRadius: '6px', padding: '8px 12px'
        }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{
          marginTop: '10px', fontSize: '12px', color: '#f87171',
          background: 'rgba(248,113,113,0.1)', borderRadius: '6px', padding: '8px 12px'
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
