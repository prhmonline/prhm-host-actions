#!/usr/bin/env bash
set -Eeuo pipefail

LE=/etc/letsencrypt/live
CERTS=/etc/nginx/certs
HISTORY=/opt/imotion-stack/cert-history
NGINX=/usr/sbin/nginx
NGINX_CONF=/etc/nginx/nginx.phase7b.conf
SERVICE=prhm-edge-nginx.service

MODE=deploy
if [[ $# -gt 1 ]]; then
  echo "invalid_arguments" >&2
  exit 64
fi
if [[ $# -eq 1 ]]; then
  [[ "$1" == "--preflight" ]] || { echo "invalid_argument" >&2; exit 64; }
  MODE=preflight
fi
if [[ "$MODE" == deploy ]]; then
  exec 9>/run/lock/prhm-edge-cert-deploy.lock
  flock -n 9 || exit 0
fi

MAPPINGS=(
  'i-motion.ir|i-motion.ir.cert.combined|i-motion.ir.key|i-motion.ir'
  'i-motion.ir|admin.i-motion.ir.cert.combined|admin.i-motion.ir.key|admin.i-motion.ir'
  'imotion.ir|imotion.ir.cert.combined|imotion.ir.key|imotion.ir'
  'imotion.ir|sale.imotion.ir.cert.combined|sale.imotion.ir.key|sale.imotion.ir'
  'imotion.ir|gym.imotion.ir.cert.combined|gym.imotion.ir.key|gym.imotion.ir'
  'imotion-iran.ir|imotion-iran.ir.cert.combined|imotion-iran.ir.key|imotion-iran.ir'
  'drtarjomeh.ir-edge|drtarjomeh/drtarjomeh.ir.cert.combined|drtarjomeh/drtarjomeh.ir.key|drtarjomeh.ir'
  'drtarjomeh.ir-edge|drtarjomeh/automation.drtarjomeh.ir.cert.combined|drtarjomeh/automation.drtarjomeh.ir.key|automation.drtarjomeh.ir'
  'cfpark.ir-edge|cfpark/cfpark.ir.cert.combined|cfpark/cfpark.ir.key|cfpark.ir'
  'moeinshow.com-edge|moeinshow/moeinshow.com.cert.combined|moeinshow/moeinshow.com.key|moeinshow.com'
  'moeinshow.com-edge|moeinshow/dashboard.moeinshow.com.cert.combined|moeinshow/dashboard.moeinshow.com.key|dashboard.moeinshow.com'
  'prhm-edge|prhm/prhm.ir.cert.combined|prhm/prhm.ir.key|prhm.ir'
  'prhm-edge|prhm/academic.prhm.ir.cert.combined|prhm/academic.prhm.ir.key|academic.prhm.ir'
  'prhm-edge|prhm/api-shifa-staging.prhm.ir.cert.combined|prhm/api-shifa-staging.prhm.ir.key|api-shifa-staging.prhm.ir'
  'prhm-edge|prhm/aranob.prhm.ir.cert.combined|prhm/aranob.prhm.ir.key|aranob.prhm.ir'
  'prhm-edge|prhm/honartik-api-staging.prhm.ir.cert.combined|prhm/honartik-api-staging.prhm.ir.key|honartik-api-staging.prhm.ir'
  'prhm-edge|prhm/honartikdashboard.prhm.ir.cert.combined|prhm/honartikdashboard.prhm.ir.key|honartikdashboard.prhm.ir'
  'prhm-edge|prhm/honartik.prhm.ir.cert.combined|prhm/honartik.prhm.ir.key|honartik.prhm.ir'
  'prhm-edge|prhm/honartik-staging.prhm.ir.cert.combined|prhm/honartik-staging.prhm.ir.key|honartik-staging.prhm.ir'
  'prhm-edge|prhm/shifa.prhm.ir.cert.combined|prhm/shifa.prhm.ir.key|shifa.prhm.ir'
  'prhm-edge|prhm/shifa-staging.prhm.ir.cert.combined|prhm/shifa-staging.prhm.ir.key|shifa-staging.prhm.ir'
  'prhm-edge|prhm/tarjomeh.prhm.ir.cert.combined|prhm/tarjomeh.prhm.ir.key|tarjomeh.prhm.ir'
  'prhm-edge|prhm/test.prhm.ir.cert.combined|prhm/test.prhm.ir.key|test.prhm.ir'
  'gisheh360-edge|gisheh360/gisheh360.ir.cert.combined|gisheh360/gisheh360.ir.key|gisheh360.ir'
)

declare -a LINEAGE CERT_REL KEY_REL HOST SRC_CERT SRC_KEY DST_CERT DST_KEY STATUS SRC_FP
declare -a CERT_EXISTED KEY_EXISTED CHANGED

declare -A DEST_SEEN
STAGE=''
BACK=''
MUTATED=0
IN_ROLLBACK=0

safe_rel() {
  local p=$1 part
  [[ -n "$p" && "$p" != /* && "$p" != *'//' ]] || return 1
  IFS='/' read -r -a _parts <<<"$p"
  for part in "${_parts[@]}"; do
    [[ -n "$part" && "$part" != '.' && "$part" != '..' ]] || return 1
  done
}

cert_pub_hash() {
  openssl x509 -in "$1" -noout -pubkey 2>/dev/null \
    | openssl pkey -pubin -outform DER 2>/dev/null \
    | sha256sum | awk '{print $1}'
}

key_pub_hash() {
  openssl pkey -in "$1" -pubout -outform DER 2>/dev/null \
    | sha256sum | awk '{print $1}'
}

cert_fingerprint() {
  openssl x509 -in "$1" -outform DER 2>/dev/null \
    | sha256sum | awk '{print $1}'
}

check_hostname() {
  local cert=$1 host=$2 sans
  if openssl x509 -help 2>&1 | grep -q -- '-checkhost'; then
    openssl x509 -in "$cert" -noout -checkhost "$host" >/dev/null 2>&1
    return
  fi
  sans=$(openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null) || return 1
  printf '%s\n' "$sans" | tr ',' '\n' | sed -E 's/^[[:space:]]+//;s/[[:space:]]+$//' | grep -Fxq "DNS:$host"
}

parse_mappings() {
  local i entry l c k h
  for i in "${!MAPPINGS[@]}"; do
    entry=${MAPPINGS[$i]}
    IFS='|' read -r l c k h <<<"$entry"
    [[ -n "$l" && -n "$h" ]] || { echo "invalid_mapping index=$i" >&2; return 1; }
    safe_rel "$c" || { echo "invalid_cert_destination mapping=$h" >&2; return 1; }
    safe_rel "$k" || { echo "invalid_key_destination mapping=$h" >&2; return 1; }
    [[ -z ${DEST_SEEN["C:$c"]+x} ]] || { echo "duplicate_cert_destination=$c" >&2; return 1; }
    [[ -z ${DEST_SEEN["K:$k"]+x} ]] || { echo "duplicate_key_destination=$k" >&2; return 1; }
    DEST_SEEN["C:$c"]=$h
    DEST_SEEN["K:$k"]=$h
    LINEAGE[$i]=$l; CERT_REL[$i]=$c; KEY_REL[$i]=$k; HOST[$i]=$h
    SRC_CERT[$i]="$LE/$l/fullchain.pem"
    SRC_KEY[$i]="$LE/$l/privkey.pem"
    DST_CERT[$i]="$CERTS/$c"
    DST_KEY[$i]="$CERTS/$k"
  done
}

validate_source() {
  local i=$1 host=${HOST[$1]} cert=${SRC_CERT[$1]} key=${SRC_KEY[$1]}
  [[ -s "$cert" ]] || { echo "source_cert_missing mapping=$host" >&2; return 1; }
  [[ -s "$key" ]] || { echo "source_key_missing mapping=$host" >&2; return 1; }
  openssl x509 -in "$cert" -noout >/dev/null 2>&1 || { echo "source_cert_invalid mapping=$host" >&2; return 1; }
  openssl pkey -in "$key" -noout >/dev/null 2>&1 || { echo "source_key_invalid mapping=$host" >&2; return 1; }
  [[ "$(cert_pub_hash "$cert")" == "$(key_pub_hash "$key")" ]] || { echo "source_key_mismatch mapping=$host" >&2; return 1; }
  check_hostname "$cert" "$host" || { echo "source_hostname_mismatch mapping=$host" >&2; return 1; }
  openssl x509 -in "$cert" -noout -checkend 86400 >/dev/null 2>&1 || { echo "source_cert_expires_within_24h mapping=$host" >&2; return 1; }
  SRC_FP[$i]=$(cert_fingerprint "$cert")
  [[ ${SRC_FP[$i]} =~ ^[a-f0-9]{64}$ ]] || { echo "source_fingerprint_failed mapping=$host" >&2; return 1; }
}

classify_destination() {
  local i=$1 cert=${DST_CERT[$1]} key=${DST_KEY[$1]}
  if [[ -e "$cert" && -e "$key" ]] && cmp -s "${SRC_CERT[$i]}" "$cert" && cmp -s "${SRC_KEY[$i]}" "$key"; then
    STATUS[$i]=UNCHANGED
  elif [[ -e "$cert" || -e "$key" ]]; then
    STATUS[$i]=DIFFERENT
  else
    STATUS[$i]=MISSING
  fi
}

validate_all() {
  local i
  parse_mappings
  for i in "${!MAPPINGS[@]}"; do
    validate_source "$i"
    classify_destination "$i"
    echo "PREFLIGHT mapping=${HOST[$i]} source=OK destination=${STATUS[$i]}"
  done
  "$NGINX" -t -c "$NGINX_CONF" >/dev/null
  echo 'PREFLIGHT nginx=OK'
}

cleanup() {
  [[ -z "$STAGE" || ! -e "$STAGE" ]] || rm -rf -- "$STAGE"
}

rollback_all() {
  local rc=0 i cert key cert_bak key_bak tmp
  IN_ROLLBACK=1
  set +e
  for i in "${CHANGED[@]}"; do
    cert=${DST_CERT[$i]}; key=${DST_KEY[$i]}
    cert_bak="$BACK/${CERT_REL[$i]}"; key_bak="$BACK/${KEY_REL[$i]}"
    if [[ ${CERT_EXISTED[$i]} == yes ]]; then
      mkdir -p "$(dirname "$cert")"
      tmp="${cert}.rollback.$$"
      cp -a -- "$cert_bak" "$tmp" && mv -f -- "$tmp" "$cert" || rc=1
    else
      rm -f -- "$cert" || rc=1
    fi
    if [[ ${KEY_EXISTED[$i]} == yes ]]; then
      mkdir -p "$(dirname "$key")"
      tmp="${key}.rollback.$$"
      cp -a -- "$key_bak" "$tmp" && mv -f -- "$tmp" "$key" || rc=1
    else
      rm -f -- "$key" || rc=1
    fi
  done
  if command -v restorecon >/dev/null 2>&1; then restorecon -RF "$CERTS" >/dev/null 2>&1 || rc=1; fi
  "$NGINX" -t -c "$NGINX_CONF" >/dev/null 2>&1 || rc=1
  systemctl reload "$SERVICE" >/dev/null 2>&1 || rc=1
  set -e
  IN_ROLLBACK=0
  return "$rc"
}

on_error() {
  local rc=$?
  trap - ERR
  if (( MUTATED == 1 && IN_ROLLBACK == 0 )); then
    if rollback_all; then
      echo 'ROLLBACK_PERFORMED=YES' >&2
    else
      echo 'FATAL_ROLLBACK_FAILURE=YES' >&2
      exit 70
    fi
  fi
  exit "$rc"
}

trap on_error ERR
trap cleanup EXIT

validate_all
[[ "$MODE" == preflight ]] && { echo 'PREFLIGHT_COMPLETE=YES'; exit 0; }

for i in "${!MAPPINGS[@]}"; do
  [[ ${STATUS[$i]} == UNCHANGED ]] || CHANGED+=("$i")
done

if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo 'CERTIFICATES_UNCHANGED'
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)-$$
BACK="$HISTORY/$TS"
mkdir -p "$HISTORY"
mkdir -m 700 "$BACK"
STAGE=$(mktemp -d "$CERTS/.prhm-edge-cert-deploy.XXXXXX")
chmod 700 "$STAGE"

for i in "${CHANGED[@]}"; do
  cert=${DST_CERT[$i]}; key=${DST_KEY[$i]}
  CERT_EXISTED[$i]=no; KEY_EXISTED[$i]=no
  if [[ -e "$cert" ]]; then
    CERT_EXISTED[$i]=yes
    mkdir -p "$BACK/$(dirname "${CERT_REL[$i]}")"
    cp -a -- "$cert" "$BACK/${CERT_REL[$i]}"
  fi
  if [[ -e "$key" ]]; then
    KEY_EXISTED[$i]=yes
    mkdir -p "$BACK/$(dirname "${KEY_REL[$i]}")"
    cp -a -- "$key" "$BACK/${KEY_REL[$i]}"
  fi
  mkdir -p "$STAGE/$(dirname "${CERT_REL[$i]}")" "$STAGE/$(dirname "${KEY_REL[$i]}")"
  install -m 600 -- "${SRC_CERT[$i]}" "$STAGE/${CERT_REL[$i]}"
  install -m 600 -- "${SRC_KEY[$i]}" "$STAGE/${KEY_REL[$i]}"
done

for i in "${CHANGED[@]}"; do
  cert=${DST_CERT[$i]}; key=${DST_KEY[$i]}
  mkdir -p "$(dirname "$cert")" "$(dirname "$key")"
  install -m 600 -- "$STAGE/${CERT_REL[$i]}" "${cert}.new.$$"
  install -m 600 -- "$STAGE/${KEY_REL[$i]}" "${key}.new.$$"
  chown 0:0 "${cert}.new.$$" "${key}.new.$$"
  MUTATED=1
  mv -f -- "${cert}.new.$$" "$cert"
  mv -f -- "${key}.new.$$" "$key"
done

if command -v restorecon >/dev/null 2>&1; then restorecon -RF "$CERTS" >/dev/null 2>&1; fi
"$NGINX" -t -c "$NGINX_CONF" >/dev/null
systemctl reload "$SERVICE"

for i in "${CHANGED[@]}"; do
  served_fp=$(timeout 8 openssl s_client -connect 127.0.0.1:8443 -servername "${HOST[$i]}" </dev/null 2>/dev/null \
    | openssl x509 -outform DER 2>/dev/null \
    | sha256sum | awk '{print $1}')
  [[ "$served_fp" == "${SRC_FP[$i]}" ]] || { echo "served_certificate_mismatch mapping=${HOST[$i]}" >&2; false; }
  echo "VERIFY mapping=${HOST[$i]} served=OK"
done

MUTATED=0
echo "CERTIFICATES_DEPLOYED backup=$BACK changed=${#CHANGED[@]}"
