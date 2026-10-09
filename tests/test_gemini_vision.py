import pytest
import json
from unittest.mock import patch, MagicMock
from pathlib import Path
from app.config import Settings
from app.clip.qwen import GeminiVisionAnalyzer, get_analyzer, TransformersAnalyzer, OracleAnalyzer, MockAnalyzer, VlmUnavailableError

@pytest.fixture
def dummy_settings():
    return Settings(
        vlm_provider="gemini",
        gemini_api_key="dummy_key",
        gemini_model="gemini-2.5-flash",
        vlm_batch_size=2
    )

@pytest.fixture
def dummy_frames(tmp_path):
    f1 = tmp_path / "f_0001.jpg"
    f2 = tmp_path / "f_0002.jpg"
    f1.write_bytes(b"dummy1")
    f2.write_bytes(b"dummy2")
    return [f1, f2]

@pytest.mark.asyncio
async def test_gemini_vision_analyzer_success(dummy_settings, dummy_frames):
    analyzer = GeminiVisionAnalyzer(dummy_settings)
    
    # Mock the underlying client method
    async def mock_call(model, payload):
        # Return standard format with two results
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": json.dumps([
                                {"clean": True, "faces": False, "text": False, "logo": False, "animation": False, "overlay": False},
                                {"clean": False, "faces": True, "text": False, "logo": False, "animation": False, "overlay": False}
                            ])}
                        ]
                    }
                }
            ]
        }
        
    with patch.object(analyzer.client, '_call_generate_content', side_effect=mock_call):
        results = await analyzer.analyze_batch(dummy_frames, mode="camera")
        assert len(results) == 2
        assert results[0]["clean"] is True
        assert results[1]["clean"] is False

@pytest.mark.asyncio
async def test_gemini_vision_analyzer_fallback_on_error(dummy_settings, dummy_frames):
    analyzer = GeminiVisionAnalyzer(dummy_settings)
    
    async def mock_call_error(model, payload):
        raise Exception("API Error")
        
    with patch.object(analyzer.client, '_call_generate_content', side_effect=mock_call_error):
        results = await analyzer.analyze_batch(dummy_frames, mode="strict")
        # Should fallback to dirty frames
        assert len(results) == 2
        assert all(r["clean"] is False for r in results)

def test_get_analyzer_routing(dummy_settings):
    # Test provider="gemini"
    analyzer = get_analyzer(dummy_settings)
    assert isinstance(analyzer, GeminiVisionAnalyzer)
    
    # Test provider="gemini" without key
    dummy_settings.gemini_api_key = None
    with pytest.raises(VlmUnavailableError):
        get_analyzer(dummy_settings)
        
    # Test provider="auto" fallback logic
    dummy_settings.vlm_provider = "auto"
    
    # If key is provided -> gemini
    dummy_settings.gemini_api_key = "dummy"
    with patch("torch.cuda.is_available", return_value=False):
        # mock torch
        import sys
        sys.modules['torch'] = MagicMock()
        sys.modules['torch'].cuda.is_available.return_value = False
        
        analyzer = get_analyzer(dummy_settings)
        assert isinstance(analyzer, GeminiVisionAnalyzer)
    
    # If no key but oracle url -> oracle
    dummy_settings.gemini_api_key = None
    dummy_settings.vlm_oracle_url = "http://oracle"
    analyzer = get_analyzer(dummy_settings)
    assert isinstance(analyzer, OracleAnalyzer)
    
    # If neither -> mock
    dummy_settings.vlm_oracle_url = None
    analyzer = get_analyzer(dummy_settings)
    assert isinstance(analyzer, MockAnalyzer)
