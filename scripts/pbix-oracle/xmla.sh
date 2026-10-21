#!/bin/bash
# Settings (env): LINBI_VM (VirtualBox VM, default w11), LINBI_VM_USER, LINBI_VM_PWFILE (file with the Windows password),
# LINBI_VM_SHARE (host folder shared with the VM, default ~/Documenti), LINBI_VM_DRIVE (its drive letter in Windows, default Z:),
# LINBI_ORACLE_WORK (scratch folder, default /tmp/linbi-oracle). Test files go to $LINBI_VM_SHARE/LinBI-test.
VM=${LINBI_VM:-w11}; VMUSER=${LINBI_VM_USER:?set LINBI_VM_USER}; PW=${LINBI_VM_PWFILE:?set LINBI_VM_PWFILE}
SHARE=${LINBI_VM_SHARE:-$HOME/Documenti}; DRIVE=${LINBI_VM_DRIVE:-Z:}
S=${LINBI_ORACLE_WORK:-/tmp/linbi-oracle}; mkdir -p $S
HERE=$(cd "$(dirname "$0")" && pwd)
T=$SHARE/LinBI-test; mkdir -p $T
# xmla.sh <file>...  : run XMLA/TMSL (or q*-named DAX/DMV queries) in order against Desktop's engine
D=$T/xmla; rm -rf $D; mkdir -p $D
i=10; for f in "$@"; do b=$(basename "$f"); case "$b" in u*) cp "$f" "$D/$i-u-$b";; q*) cp "$f" "$D/$i-q-${b#q}";; *) cp "$f" "$D/$i-c-$b";; esac; i=$((i+1)); done
[ "$(cat $T/_port 2>/dev/null)" = 61000 ] && $HERE/vm.sh oracle >/dev/null
$HERE/vm.sh ps $HERE/xmla.ps1
