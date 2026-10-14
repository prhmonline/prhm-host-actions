#!/usr/bin/env bash
# Disposable GitHub-hosted runner dataplane test. Never run on Node1.
# Only fake Production endpoints inside an isolated network namespace.
set -Eeuo pipefail
umask 077

if [[ "\${PRHM_CI_DISPOSABLE_LAB:-}" != "yes" || "\${GITHUB_ACTIONS:-}" != "true" || "\${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]]; then
  echo "LAB_REJECTED=missing_disposable_runner_binding" >&2; exit 81
fi
[[ "$(id -u)" == 0 ]] || { echo "LAB_REJECTED=needs_root_on_disposable_runner" >&2; exit 82; }
for tool in ip nft python3 timeout; do command -v "$tool" >/dev/null || exit 83; done
for name in ciw47 cip47 ciu47; do
  if ip netns list | grep -q "^$name "; then
    echo "LAB_REJECTED=netns_collision" >&2; exit 84
  fi
done
if ip link show virbr-ci >/dev/null 2>&1; then
  echo "LAB_REJECTED=bridge_collision" >&2; exit 85
fi
if nft list table inet prhm_ci_isolation >/dev/null 2>&1; then
  echo "LAB_REJECTED=nft_guard_collision" >&2; exit 86
fi

workdir="$(mktemp -d)"
orig_forward="$(sysctl -n net.ipv4.ip_forward)"
listeners=()
cleanup() {
  set +e
  for pid in "\${listeners[@]}"; do kill "$pid" >/dev/null 2>&1 || true; done
  nft delete table inet prhm_ci_isolation >/dev/null 2>&1 || true
  nft delete table inet prhm_ci_lab_existing >/dev/null 2>&1 || true
  for ns in ciw47 cip47 ciu47; do ip netns del "$ns" >/dev/null 2>&1 || true; done
  for dev in virbr-ci cih47 cip-host47 ciu-host47; do ip link del "$dev" >/dev/null 2>&1 || true; done
  sysctl -qw net.ipv4.ip_forward="$orig_forward"
  rm -rf -- "$workdir"
}
trap cleanup EXIT

ip netns add ciw47
ip netns add cip47
ip netns add ciu47
ip link add virbr-ci type bridge
ip address add 10.72.0.1/24 dev virbr-ci
ip link set virbr-ci up

ip link add cih47 type veth peer name ciworker47
ip link set ciworker47 netns ciw47
ip link set cih47 master virbr-ci
ip link set cih47 up
ip -n ciw47 address add 10.72.0.120/24 dev ciworker47
ip -n ciw47 link set lo up
ip -n ciw47 link set ciworker47 up
ip -n ciw47 route add default via 10.72.0.1

ip link add cip-host47 type veth peer name cip-peer47
ip link set cip-peer47 netns cip47
ip address add 10.71.0.1/24 dev cip-host47
ip link set cip-host47 up
ip -n cip47 address add 10.71.0.118/24 dev cip-peer47
ip -n cip47 link set lo up
ip -n cip47 link set cip-peer47 up
ip -n cip47 route add 10.72.0.0/24 via 10.71.0.1

ip link add ciu-host47 type veth peer name ciu-peer47
ip link set ciu-peer47 netns ciu47
ip address add 9.8.7.1/24 dev ciu-host47
ip link set ciu-host47 up
ip -n ciu47 address add 9.8.7.6/24 dev ciu-peer47
ip -n ciu47 link set lo up
ip -n ciu47 link set ciu-peer47 up
ip -n ciu47 route add 10.72.0.0/24 via 9.8.7.1
sysctl -qw net.ipv4.ip_forward=1

cat > "$workdir/server.py" <<'PY'
import select
import socket
import sys
servers = []
for port in map(int, sys.argv[1:]):
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", port))
    server.listen(20)
    servers.append(server)
print("LAB_SERVER_READY", flush=True)
while True:
    readable, _, _ = select.select(servers, [], [], 1)
    for s in readable:
        connection, _ = s.accept()
        connection.close()
PY
ip netns exec cip47 python3 "$workdir/server.py" 22 443 > "$workdir/prod.log" 2>&1 &
listeners+=("$!")
ip netns exec ciu47 python3 "$workdir/server.py" 80 443 > "$workdir/public.log" 2>&1 &
listeners+=("$!")
python3 "$workdir/server.py" 2222 > "$workdir/host.log" 2>&1 &
listeners+=("$!")

tcp_check() {
  ip netns exec ciw47 timeout 2 bash -c \
    'exec 7<>/dev/tcp/"$1"/"$2"' bash "$1" "$2" 2>/dev/null
}
for _ in $(seq 1 40); do
  if grep -q LAB_SERVER_READY "$workdir/prod.log" &&
     grep -q LAB_SERVER_READY "$workdir/public.log" &&
     grep -q LAB_SERVER_READY "$workdir/host.log"; then break; fi
  sleep 0.1
done
grep -q LAB_SERVER_READY "$workdir/prod.log" || exit 87
grep -q LAB_SERVER_READY "$workdir/public.log" || exit 87
grep -q LAB_SERVER_READY "$workdir/host.log" || exit 87

nft -f - <<'NFT'
table inet prhm_ci_lab_existing {
  chain forward { type filter hook forward priority 0; policy accept; }
}
NFT

# Must be reachable before adding guard, or negative proof is invalid.
tcp_check 10.71.0.118 22 || { echo "LAB_FAIL=prod_mock_unreachable_before_guard"; exit 88; }
tcp_check 9.8.7.6 80 || { echo "LAB_FAIL=public_80_unreachable_before_guard"; exit 88; }
tcp_check 9.8.7.6 443 || { echo "LAB_FAIL=public_443_unreachable_before_guard"; exit 88; }
tcp_check 10.72.0.1 2222 || { echo "LAB_FAIL=host_unreachable_before_guard"; exit 88; }
echo "LAB_PRE_GUARD_CONNECTIVITY=PASS"

nft --check --file infra/shared-ci/ci-isolation.nft.review
nft --file infra/shared-ci/ci-isolation.nft.review
nft list table inet prhm_ci_isolation >/dev/null

if tcp_check 10.71.0.118 22; then echo "LAB_FAIL=prod_ssh_reachable" >&2; exit 89; fi
if tcp_check 10.71.0.118 443; then echo "LAB_FAIL=prod_https_reachable" >&2; exit 89; fi
if tcp_check 10.72.0.1 2222; then echo "LAB_FAIL=host_management_reachable" >&2; exit 89; fi
if tcp_check 9.8.7.6 80; then echo "LAB_FAIL=public_http_reachable" >&2; exit 89; fi
tcp_check 9.8.7.6 443 || { echo "LAB_FAIL=public_https_blocked" >&2; exit 90; }
echo "LAB_POST_GUARD_ISOLATION=PASS"

nft delete table inet prhm_ci_isolation
tcp_check 10.71.0.118 22 || { echo "LAB_FAIL=rollback_not_observed"; exit 91; }
echo "LAB_GUARD_ROLLBACK=PASS"
echo "LAB_PRODUCTION_TOUCHED=NO"
