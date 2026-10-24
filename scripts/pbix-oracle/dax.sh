#!/bin/bash
# Settings (env): MIBBI_VM (VirtualBox VM, default w11), MIBBI_VM_USER, MIBBI_VM_PWFILE (file with the Windows password),
# MIBBI_VM_SHARE (host folder shared with the VM, default ~/Documenti), MIBBI_VM_DRIVE (its drive letter in Windows, default Z:),
# MIBBI_ORACLE_WORK (scratch folder, default /tmp/mib-bi-oracle). Test files go to $MIBBI_VM_SHARE/MiB-BI-test.
VM=${MIBBI_VM:-w11}; VMUSER=${MIBBI_VM_USER:?set MIBBI_VM_USER}; PW=${MIBBI_VM_PWFILE:?set MIBBI_VM_PWFILE}
SHARE=${MIBBI_VM_SHARE:-$HOME/Documenti}; DRIVE=${MIBBI_VM_DRIVE:-Z:}
S=${MIBBI_ORACLE_WORK:-/tmp/mib-bi-oracle}; mkdir -p $S
HERE=$(cd "$(dirname "$0")" && pwd)
T=$SHARE/MiB-BI-test; mkdir -p $T
printf '%s' "$1" > $T/_q.txt
$HERE/vm.sh ps $HERE/dax.ps1
