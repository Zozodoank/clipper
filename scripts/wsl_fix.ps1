# Perbaikan Error WSL: WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED
# Harus dijalankan sebagai Administrator!

Write-Host "Mengaktifkan fitur Windows Subsystem for Linux (WSL)..." -ForegroundColor Cyan
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart

Write-Host "Mengaktifkan fitur Virtual Machine Platform..." -ForegroundColor Cyan
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart

Write-Host ""
Write-Host "PENTING: Komponen WSL telah diaktifkan, tapi Anda HARUS melakukan RESTART PC Anda sekarang!" -ForegroundColor Red
Write-Host "Setelah restart, jalankan perintah berikut secara manual di PowerShell biasa:" -ForegroundColor Yellow
Write-Host "1. wsl --update"
Write-Host "2. wsl --set-default-version 2"
Write-Host "3. wsl --install -d Ubuntu"
Write-Host ""
Write-Host "Catatan Troubleshooting Tambahan:"
Write-Host "- Jika masih error virtualisasi: Pastikan fitur 'Virtualization Technology (VT-x / AMD-V)' sudah AKTIF di dalam BIOS PC Anda."
Write-Host "- Jika wsl --install macet/gagal karena Microsoft Store bermasalah: Gunakan 'wsl --install --no-distribution' lalu unduh Ubuntu manual via Invoke-WebRequest."
Write-Host "- Jika WSL sudah jalan tapi tidak ada internet: Buat file /etc/wsl.conf dan matikan auto-generate resolv.conf, lalu atur nameserver manual ke 8.8.8.8 di /etc/resolv.conf."
