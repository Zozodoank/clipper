import asyncio
import os
import pytest
from unittest.mock import MagicMock
from app.config import Settings
from app.video.resolver import resolve_video, ResolveError

@pytest.mark.asyncio
async def test_resolve_video_timeout_retry_and_kill(monkeypatch):
    class MockProcess:
        def __init__(self, rc=0, out=b"", err=b""):
            self.returncode = rc
            self.pid = 1234
            self._out = out
            self._err = err
            self.kill_called = False
            self.wait_called = False
            
        async def communicate(self):
            raise asyncio.TimeoutError()
            
        def kill(self):
            self.kill_called = True
            
        async def wait(self):
            self.wait_called = True

    mock_proc = MockProcess()
    
    async def mock_exec(*args, **kwargs):
        return mock_proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", mock_exec)
    
    # Mock os.killpg for POSIX
    killpg_called = False
    def mock_killpg(pid, sig):
        nonlocal killpg_called
        killpg_called = True
        
    if os.name == "posix":
        monkeypatch.setattr(os, "killpg", mock_killpg)
        
    settings = Settings(ytdlp_timeout_sec=0.1, ytdlp_max_retries=2, ytdlp_retry_sleep_sec=0)
    
    with pytest.raises(ResolveError) as exc_info:
        await resolve_video("https://youtube.com/watch?v=123", settings)
        
    assert exc_info.value.kind == "timeout"
    assert "yt-dlp timeout" in str(exc_info.value)
    assert mock_proc.wait_called
    if os.name == "posix":
        assert killpg_called
    else:
        assert mock_proc.kill_called

@pytest.mark.asyncio
async def test_resolve_video_exit_error_no_retry(monkeypatch):
    class MockProcess:
        def __init__(self):
            self.returncode = 1
            self.pid = 1234
            
        async def communicate(self):
            return b"", b"ERROR: Video unavailable"
            
        async def wait(self): pass

    async def mock_exec(*args, **kwargs):
        return MockProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", mock_exec)
    
    settings = Settings(ytdlp_timeout_sec=1.0, ytdlp_max_retries=3, ytdlp_retry_sleep_sec=0)
    
    with pytest.raises(ResolveError) as exc_info:
        await resolve_video("https://youtube.com/watch?v=123", settings)
        
    assert exc_info.value.kind == "exit"
    assert "yt-dlp exit 1" in str(exc_info.value)
