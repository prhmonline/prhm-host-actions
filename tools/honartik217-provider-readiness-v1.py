#!/usr/bin/env python3
# Issue #217 — PROVIDER PRE-FLIGHT ONLY. Python 3.6 compatible.
# Never installs, patches, restarts, approves, fetches or executes source.
from __future__ import print_function
import hashlib
import json
import os
import stat
import subprocess
import sys

EXPECTED = (
    ('agent_api', '/opt/prhm-agent-selfmaint/server.js',
     '4c29d01a248d59ee85754dfa5a59e8132fe22e6b34ef04324228c16c88727406', 0o644),
    ('root_executor', '/opt/prhm-agent-selfmaint-exec/server.js',
     '410406ba0965ef3a5cad6da6306a85335e38acc3637fb6ed60fa42200a10c2e0', 0o755),
    ('mcp', '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
     'bd768f992dab75710558e3f47187c311c2ee5b5ec6f5751a74e0bbfa64729166', 0o600),
    ('policy', '/opt/prhm-company-control-plane/config/approval-policy.json',
     '148fe2a724befc15cd8c731b0195d83e254d39215792a5084b70dd5b5c178174', 0o644),
)
SERVICES = (
    'prhm-agent-selfmaint-exec.service',
    'prhm-company-approval-bridge.service',
)
ACTION = 'honartik_universal_installer_upgrade_v1'
POLICY_PATH = EXPECTED[3][1]
ARTIFACTS = (
    '/opt/prhm-agent-selfmaint-exec/actions/honartik-universal-installer-native-dispatch-trust-v1.cjs',
    '/opt/prhm-agent-selfmaint-exec/actions/honartik-universal-installer-native-root-transaction-v1.cjs',
)
ARCHIVE = '/var/tmp/honartik-universal-integrated-candidate-linux.tar.gz'
ARCHIVE_SHA256 = 'e49ed1ce6366f87fad8dc2e46fd69c323c3cafb3729e90cdaaebe5421898212c'
BASELINE_VERSION = '2026-10-02.1-control-plane-current-owner-bootstrap-repair-v1'
PINNED_SOURCE_HEAD = 'f914e8ac4e0bc3d7b9845907c651f8d1cf97e0ea'


def safe_read(path, max_size):
    """Use O_NOFOLLOW and inode/metadata checks; never print file contents."""
    a = os.lstat(path)
    if not stat.S_ISREG(a.st_mode) or a.st_nlink != 1:
        raise ValueError('unsafe_file')
    if a.st_uid != 0 or (a.st_mode & 0o022) != 0:
        raise ValueError('unsafe_owner_or_mode')
    if not 0 < a.st_size <= max_size:
        raise ValueError('unsafe_size')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        b = os.fstat(fd)
        if (a.st_dev, a.st_ino, a.st_size, a.st_uid, a.st_gid, a.st_mode) != (
                b.st_dev, b.st_ino, b.st_size, b.st_uid, b.st_gid, b.st_mode):
            raise ValueError('source_changed')
        h = hashlib.sha256()
        data = bytearray()
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
            if max_size <= 131072:
                data.extend(chunk)
        end = os.fstat(fd)
        if (b.st_dev, b.st_ino, b.st_size, b.st_mtime_ns, b.st_ctime_ns) != (
                end.st_dev, end.st_ino, end.st_size, end.st_mtime_ns, end.st_ctime_ns):
            raise ValueError('source_mutated_during_read')
        return h.hexdigest(), a, bytes(data)
    finally:
        os.close(fd)


def service_state(name):
    p = subprocess.Popen(['systemctl', 'is-active', name],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         universal_newlines=True)
    stdout, _ = p.communicate()
    return stdout.strip() if p.returncode == 0 else 'NOT_ACTIVE_OR_UNAVAILABLE'


def run_host():
    if not hasattr(os, 'geteuid') or os.geteuid() != 0:
        print('PREFLIGHT=STOP root_console_required')
        return 77
    good = True
    policy_bytes = None
    print('READ_ONLY=YES')
    print('SOURCE_HEAD_REFERENCE=' + PINNED_SOURCE_HEAD)
    for name, filename, expected, mode in EXPECTED:
        try:
            actual, st, contents = safe_read(filename, 2 * 1024 * 1024)
            ok = actual == expected and st.st_uid == 0 and st.st_gid == 0 and (
                stat.S_IMODE(st.st_mode) == mode)
            if name == 'policy':
                policy_bytes = contents
            print('OWNER_' + name.upper() + '=' + ('PASS' if ok else 'STOP'))
            good = good and ok
        except (OSError, ValueError) as error:
            print('OWNER_' + name.upper() + '=STOP_' + type(error).__name__)
            good = False
    for service in SERVICES:
        state = service_state(service)
        print('SERVICE_' + service.split('.')[0].upper().replace('-', '_') + '=' + state)
        good = good and state == 'active'
    if policy_bytes is not None:
        try:
            policy = json.loads(policy_bytes.decode('utf-8'))
            registered = 'host_action.' + ACTION in policy.get('operations', {})
            scoped = any(isinstance(x, dict) and x.get('action') == ACTION
                         for x in policy.get('typed_scopes', []))
            print('POLICY_VERSION=' + str(policy.get('version', 'UNKNOWN')))
            print('POLICY_ACTION_PRESENT=' + ('YES' if registered else 'NO'))
            print('POLICY_SCOPE_PRESENT=' + ('YES' if scoped else 'NO'))
            if policy.get('version') != BASELINE_VERSION and not (registered and scoped):
                good = False
            # Existing policy is intentionally NOT activation evidence.
        except (ValueError, TypeError, UnicodeError):
            print('POLICY_PARSE=STOP')
            good = False
    else:
        print('POLICY_PARSE=STOP_UNREADABLE')
        good = False
    for i, filename in enumerate(ARTIFACTS):
        try:
            digest, st, _ = safe_read(filename, 1024 * 1024)
            print('ROOT_MODULE_{}=PRESENT_NOT_AUTHORIZATION'.format(i + 1))
        except (OSError, ValueError):
            print('ROOT_MODULE_{}=NOT_VERIFIED'.format(i + 1))
    try:
        digest, st, _ = safe_read(ARCHIVE, 64 * 1024 * 1024)
        print('CANDIDATE_ARCHIVE=' + (
            'PASS' if digest == ARCHIVE_SHA256 else 'SHA_MISMATCH'))
        good = good and digest == ARCHIVE_SHA256
    except (OSError, ValueError):
        print('CANDIDATE_ARCHIVE=NOT_VERIFIED')
        good = False
    print('PREIMAGE_AND_SERVICE_PREFLIGHT=' + ('PASS' if good else 'STOP'))
    print('INDEPENDENT_REVIEW_CONFIRMED=NO_LOCAL_ATTESTATION')
    print('PROVIDER_BOOTSTRAP_EXECUTED=NO')
    print('L4_APPROVAL_ISSUED=NO')
    print('INSTALL_AUTHORIZED_BY_THIS_TOOL=NO')
    return 0 if good else 2


def run_ci():
    # Fixed-source sanity contract. No live host files or shell are touched.
    root = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
    required = (
        'honartik-universal-installer-owner-bootstrap-native-fs-v1.cjs',
        'honartik-universal-installer-owner-bootstrap-plan-review-v1.cjs',
        'honartik-universal-installer-native-dispatch-trust-v1.cjs',
        'honartik-universal-installer-native-root-transaction-v1.cjs',
        'test-honartik-universal-installer-owner-bootstrap-linux-v1.cjs',
        'test-honartik-universal-installer-owner-bootstrap-plan-review-v1.cjs',
    )
    if not all(os.path.isfile(os.path.join(root, f)) for f in required):
        print('PROVIDER_SOURCE_CLOSURE=STOP')
        return 2
    plan = open(os.path.join(root, required[1]), 'rb').read()
    root_tx = open(os.path.join(root, required[3]), 'rb').read()
    if b'NO_PRODUCTION_WRITER:true' not in plan or (
            b'PRODUCTION_EXECUTION_AUTHORIZED:false' not in root_tx):
        print('PROVIDER_SOURCE_FLAGS=STOP')
        return 2
    print('PROVIDER_SOURCE_CLOSURE=PASS')
    print('PROVIDER_SOURCE_ONLY=YES')
    print('ROOT_REGISTRATION_TESTED=NO')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('--host-readonly', '--ci-source'):
        print('USAGE: --ci-source | --host-readonly (never installs)')
        sys.exit(64)
    if sys.argv[1] == '--ci-source':
        sys.exit(run_ci())
    sys.exit(run_host())
