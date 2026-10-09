import paramiko
import base64

hostname = '10.207.87.226'
port = 8022
username = 'u0_a466'
password = '123456'

script = r"""
import os
import json
import re
import subprocess

kaggle_user = "xxxjho"

print("Finding kernel-metadata.json...")
find_out = subprocess.getoutput("find /data/data/com.termux -name 'kernel-metadata.json' 2>/dev/null")
paths = [p for p in find_out.split('\n') if p.strip()]

if not paths:
    print("Could not find clipper directory anywhere!")
    exit(1)

meta_path = paths[0]
print(f"Found at: {meta_path}")

try:
    with open(meta_path, "r") as f:
        meta = json.load(f)
    meta["id"] = f"{kaggle_user}/clipper-oracle"
    meta["title"] = "clipper-oracle"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print("Metadata updated successfully.")
except Exception as e:
    print(f"Metadata error: {e}")

py_path = meta_path.replace("kaggle/kernel/kernel-metadata.json", "scripts/start_kaggle_oracle.py")
try:
    with open(py_path, "r") as f:
        py_content = f.read()
    py_content = re.sub(r'["\'][a-zA-Z0-9_-]+/clipper-oracle["\']', f'"{kaggle_user}/clipper-oracle"', py_content)
    with open(py_path, "w") as f:
        f.write(py_content)
    print("Launcher script updated successfully.")
except Exception as e:
    print(f"Script error: {e}")
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(hostname, port=port, username=username, password=password, timeout=10)
    
    encoded = base64.b64encode(script.encode('utf-8')).decode('utf-8')
    cmd = f"echo {encoded} | base64 -d | python"
    
    print("\\n--- Running fix script ---")
    stdin, stdout, stderr = client.exec_command(cmd)
    print("STDOUT:")
    print(stdout.read().decode('utf-8'))
    print("STDERR:")
    print(stderr.read().decode('utf-8'))
            
except Exception as e:
    print(f"Connection failed: {e}")
finally:
    client.close()
