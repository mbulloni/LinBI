#!/bin/bash
# Settings (env): MIBBI_VM (VirtualBox VM, default w11), MIBBI_VM_USER, MIBBI_VM_PWFILE (file with the Windows password),
# MIBBI_VM_SHARE (host folder shared with the VM, default ~/Documenti), MIBBI_VM_DRIVE (its drive letter in Windows, default Z:),
# MIBBI_ORACLE_WORK (scratch folder, default /tmp/mib-bi-oracle). Test files go to $MIBBI_VM_SHARE/LinBI-test.
VM=${MIBBI_VM:-w11}; VMUSER=${MIBBI_VM_USER:?set MIBBI_VM_USER}; PW=${MIBBI_VM_PWFILE:?set MIBBI_VM_PWFILE}
SHARE=${MIBBI_VM_SHARE:-$HOME/Documenti}; DRIVE=${MIBBI_VM_DRIVE:-Z:}
S=${MIBBI_ORACLE_WORK:-/tmp/mib-bi-oracle}; mkdir -p $S
HERE=$(cd "$(dirname "$0")" && pwd)
T=$SHARE/LinBI-test; mkdir -p $T
# xmla.sh <file>...  : run XMLA/TMSL (or q*-named DAX/DMV queries) in order against Desktop's engine
D=$T/xmla; rm -rf $D; mkdir -p $D
i=10; for f in "$@"; do b=$(basename "$f"); case "$b" in u*) cp "$f" "$D/$i-u-$b";; q*) cp "$f" "$D/$i-q-${b#q}";; *) cp "$f" "$D/$i-c-$b";; esac; i=$((i+1)); done
[ "$(cat $T/_port 2>/dev/null)" = 61000 ] && $HERE/vm.sh oracle >/dev/null
$HERE/vm.sh ps $HERE/xmla.ps1
