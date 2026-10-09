# wsl_fix.ps1
# Jalankan script ini sebagai Administrator di PowerShell untuk memperbaiki error WSL:
# Wsl/WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED

# Mengaktifkan WSL (Windows Subsystem for Linux)
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart

# Mengaktifkan Virtual Machine Platform (Dibutuhkan untuk WSL 2)
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart

Write-Host "=========================================================================="
Write-Host "SUKSES: Fitur WSL telah diaktifkan."
Write-Host "ANDA WAJIB RESTART PC/LAPTOP SEKARANG agar perubahan dapat diterapkan!"
Write-Host "=========================================================================="
Write-Host ""
Write-Host "Setelah restart, jalankan perintah berikut di PowerShell biasa:"
Write-Host "1. wsl --update"
Write-Host "2. wsl --set-default-version 2"
Write-Host "3. wsl --install -d Ubuntu"
Write-Host ""
Write-Host "Catatan Troubleshooting Tambahan:"
Write-Host "- Jika Virtual Machine Platform gagal berjalan, pastikan 'Virtualization' diaktifkan di BIOS."
Write-Host "- Jika Microsoft Store diblokir, jalankan 'wsl --install --no-distribution' lalu unduh Ubuntu manual."
Write-Host "- Jika koneksi WSL error, ubah nameserver di /etc/resolv.conf ke 8.8.8.8"
