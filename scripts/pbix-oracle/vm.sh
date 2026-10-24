#!/bin/bash
# Settings (env): MIBBI_VM (VirtualBox VM, default w11), MIBBI_VM_USER, MIBBI_VM_PWFILE (file with the Windows password),
# MIBBI_VM_SHARE (host folder shared with the VM, default ~/Documenti), MIBBI_VM_DRIVE (its drive letter in Windows, default Z:),
# MIBBI_ORACLE_WORK (scratch folder, default /tmp/mib-bi-oracle). Test files go to $MIBBI_VM_SHARE/MiB-BI-test.
VM=${MIBBI_VM:-w11}; VMUSER=${MIBBI_VM_USER:?set MIBBI_VM_USER}; PW=${MIBBI_VM_PWFILE:?set MIBBI_VM_PWFILE}
SHARE=${MIBBI_VM_SHARE:-$HOME/Documenti}; DRIVE=${MIBBI_VM_DRIVE:-Z:}
S=${MIBBI_ORACLE_WORK:-/tmp/mib-bi-oracle}; mkdir -p $S
HERE=$(cd "$(dirname "$0")" && pwd)
T=$SHARE/MiB-BI-test; mkdir -p $T
# vm.sh ps <script.ps1> | vm.sh oracle (start disk-mode engine on :61000) | vm.sh open <file under ~/Documenti> | vm.sh shot <name>
runps() {
  cp "$1" $T/_cmd.ps1
  VBoxManage guestcontrol $VM run --username "$VMUSER" --passwordfile $PW \
    --exe 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -- powershell -NoProfile -ExecutionPolicy Bypass -File "$DRIVE\MiB-BI-test\_cmd.ps1"
  rm -f $T/_cmd.ps1
}
case "$1" in
  ps) runps "$2" ;;
  oracle) runps $HERE/oracle-start.ps1 ;;
  open)
    win="$DRIVE\\$(realpath --relative-to="$SHARE" "$2" | sed 's#/#\\#g')"
    cat > $S/_open.ps1 <<EOF
\$keep = (Get-NetTCPConnection -State Listen -LocalPort 61000 -ErrorAction SilentlyContinue | Select -First 1).OwningProcess
Get-Process PBIDesktop -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process msmdsrv -ErrorAction SilentlyContinue | ? { \$_.Id -ne \$keep } | Stop-Process -Force
Start-Sleep 2
\$a = New-ScheduledTaskAction -Execute 'C:\Program Files\Microsoft Power BI Desktop\bin\PBIDesktop.exe' -Argument '"$win"'
\$p = New-ScheduledTaskPrincipal -UserId '$VMUSER' -LogonType Interactive
Register-ScheduledTask -TaskName MiBBIOpen -Action \$a -Principal \$p -Force | Out-Null
Start-ScheduledTask -TaskName MiBBIOpen
'started'
EOF
    runps $S/_open.ps1 ;;
  title)
    printf '%s\n' 'Get-Process PBIDesktop -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle }' > $S/_t.ps1
    runps $S/_t.ps1 ;;
  shot) VBoxManage controlvm $VM screenshotpng $S/$2.png ;;
esac
