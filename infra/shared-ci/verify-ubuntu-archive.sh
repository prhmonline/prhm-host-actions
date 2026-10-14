#!/usr/bin/env bash
# GitHub-hosted offline-to-infrastructure vendor attestation only.
# Downloads only public checksums, detached signature, and public key to a temp
# directory. Does not access/modify Node1, Production or the image itself.
set -euo pipefail
umask 077

FPR="D2EB44626FDDC30B513D5BB71A5D6C4C7DB87C81"
EXPECTED_SHA="ffe6203da54deeb6db5d2a98a83f9ec8e55f149d3f7ba622e1abe5fa966ee3d6"
RELEASE_BASE="https://cloud-images.ubuntu.com/releases/noble/release-20260705"
KEY_URL="https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x${FPR}"

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

for name in SHA256SUMS SHA256SUMS.gpg; do
  curl --fail --location --silent --show-error --retry 2 \
    --connect-timeout 15 --max-time 70 \
    "${RELEASE_BASE}/${name}" -o "${tmp}/${name}"
  test -s "${tmp}/${name}"
done

curl --fail --location --silent --show-error --retry 2 \
  --connect-timeout 15 --max-time 70 \
  "${KEY_URL}" -o "${tmp}/cloud-image-uec-key.asc"
test -s "${tmp}/cloud-image-uec-key.asc"

# Only accept the explicitly pinned Canonical-documented UEC key fingerprint.
gpg --batch --show-keys --with-colons "${tmp}/cloud-image-uec-key.asc" |
  awk -F: -v expected="${FPR}" '$1=="fpr" && $10==expected {match_found=1}
            END {if (!match_found) exit 1}'

gpg --batch --quiet --no-default-keyring \
  --keyring "${tmp}/uec-keyring.gpg" --import "${tmp}/cloud-image-uec-key.asc"
gpgv --status-fd 1 --keyring "${tmp}/uec-keyring.gpg" \
  "${tmp}/SHA256SUMS.gpg" "${tmp}/SHA256SUMS" > "${tmp}/gpg-status"

awk -v expected="${FPR}" \
  '$1=="[GNUPG:]" && $2=="VALIDSIG" {for (i=3;i<=NF;i++) if ($i==expected) match_found=1}
   END {if (!match_found) exit 1}' "${tmp}/gpg-status"

python3 - "${tmp}/SHA256SUMS" "${EXPECTED_SHA}" <<'PY'
from pathlib import Path
import sys
sums = Path(sys.argv[1]).read_text(encoding="utf-8")
expected = sys.argv[2]
names = {"ubuntu-24.04-server-cloudimg-amd64.img", "noble-server-cloudimg-amd64.img"}
rows = [row.split() for row in sums.splitlines()]
matched = [(r[0], r[1].removeprefix("*").removeprefix("./")) for r in rows
           if len(r) == 2 and r[1].removeprefix("*").removeprefix("./") in names]
if len(matched) != 1 or matched[0][0] != expected:
    raise SystemExit("STOP: official signed release SHA256 did not match Node1 reported image hash")
print("UBUNTU_CLOUD_IMAGE_20260705_SIGNED_RELEASE=PASS")
print("CLOUD_IMAGE_SHA256=" + expected)
PY
