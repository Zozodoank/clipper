import os
import sys
import time
import subprocess
import urllib.request
import urllib.error

CACHE_FILE = os.path.expanduser("~/.clipper/.oracle_url.cache")

def check_health(url: str) -> bool:
    try:
        req = urllib.request.Request(f"{url}/health", method="GET")
        with urllib.request.urlopen(req, timeout=5) as res:
            if res.status == 200:
                return True
    except Exception:
        pass
    return False

def push_kernel():
    print("Pushing kaggle kernel...", file=sys.stderr)
    subprocess.run(["kaggle", "kernels", "push", "-p", "kaggle/kernel"], check=True)

def wait_for_kernel():
    max_wait = 20 * 60  # 20 minutes
    start_time = time.time()
    
    while time.time() - start_time < max_wait:
        res = subprocess.run(
            ["kaggle", "kernels", "status", "zozodoank/clipper-oracle"], 
            capture_output=True, text=True
        )
        status = res.stdout.strip()
        print(f"Kernel status: {status}", file=sys.stderr)
        
        if "complete" in status.lower() or "error" in status.lower():
            # Usually we don't want it to complete, because it runs a web server.
            # But Kaggle CLI might show it as "running" then we can pull the output?
            # Actually, the oracle saves the URL to a file before serving.
            # We can try to pull the output periodically if it's running.
            pass
            
        if "running" in status.lower():
            # It's running! Let's try to pull the output
            out_dir = os.path.expanduser("~/.clipper/kaggle_out")
            os.makedirs(out_dir, exist_ok=True)
            subprocess.run(
                ["kaggle", "kernels", "output", "zozodoank/clipper-oracle", "-p", out_dir],
                capture_output=True
            )
            
            url_file = os.path.join(out_dir, "oracle_url.txt")
            if os.path.exists(url_file):
                with open(url_file, "r") as f:
                    url = f.read().strip()
                if url and url.startswith("http"):
                    return url
        
        time.sleep(30)
    
    print("Timeout waiting for Kaggle GPU queue.", file=sys.stderr)
    return None

def main():
    # 1. Check cache
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r") as f:
            cached_url = f.read().strip()
        if cached_url and check_health(cached_url):
            print(f"Using cached healthy oracle: {cached_url}", file=sys.stderr)
            print(cached_url)
            return

    # 2. Push and Wait
    try:
        push_kernel()
        url = wait_for_kernel()
        if url:
            if check_health(url):
                os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
                with open(CACHE_FILE, "w") as f:
                    f.write(url)
                print(f"Successfully started Kaggle Oracle: {url}", file=sys.stderr)
                print(url)
                return
            else:
                print("Oracle URL found but health check failed.", file=sys.stderr)
    except Exception as e:
        print(f"Error managing Kaggle kernel: {e}", file=sys.stderr)

    # 3. Fallback to VPS or Mock
    vps_url = os.environ.get("VLM_ORACLE_URL") or os.environ.get("NGROK_URL")
    if vps_url:
        print("Falling back to pre-configured VLM_ORACLE_URL/NGROK_URL.", file=sys.stderr)
        print(vps_url)
    else:
        print("WARNING: Using mock provider. Set VLM_PROVIDER=mock in env if needed.", file=sys.stderr)
        print("mock://localhost")

if __name__ == "__main__":
    main()
