#!/usr/bin/env python3
"""Read-only exact U06 Level-4 Approval Center policy candidate preview.

Python 3.6+ compatible. Does not write, install, approve, grant Root,
change MySQL, reveal credentials or alter a Production policy. 
The candidate digest is only for future independent installer review.
"""
import hashlib
import json
import os
import socket
import stat
import sys

POLICY = '/opt/prhm-company-control-plane/config/approval-policy.json'
PINNED = '26359a31efdfe0acde07cc9f4001afddee98efaa206e4528880068bf93c425f5'
HOST = 'prhm-production.prhm.ir'
ACTION = 'honartik_u06_native_backup_register_v1'
OPERATION = 'host_action.' + ACTION
ROLLBACK = 'host-action-v2:honartik-u06-native-backup:durable-verified-root-rollback'
EXPECTED_CANDIDATE_SHA256 = 'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934'
EXPECTED_CANDIDATE_SIZE = 32036


def require(ok, msg):
    if not ok:
        raise ValueError('U06_L4_POLICY_PREVIEW_' + msg)


def sha(blob):
    return hashlib.sha256(blob).hexdigest()


def candidate(source):
    """Return a new deterministic JSON policy; never modify source object."""
    require(isinstance(source, dict), 'SOURCE_SHAPE')
    require(source.get('schema_version') == 'prhm.approval-policy.v1',
            'SCHEMA')
    require(source.get('default_deny') is True and
            source.get('scope_freeze') is True and
            source.get('one_time_use') is True and
            source.get('issuer') == 'prhm-company-approval', 'POLICY_GUARDS')
    level4 = source.get('levels', {}).get('4', {})
    require(level4.get('human_approval') is True and
            level4.get('second_confirmation_required') is True and
            level4.get('max_ttl_seconds') == 180, 'LEVEL4_GUARDS')
    ver = source.get('version')
    require(isinstance(ver, str) and len(ver) >= 8, 'VERSION')
    operations = source.get('operations')
    scopes = source.get('typed_scopes')
    require(isinstance(operations, dict) and isinstance(scopes, list),
            'REGISTRY_SHAPE')
    require(OPERATION not in operations and
            not any(isinstance(s, dict) and
                    (s.get('action') == ACTION or
                     s.get('operation') == OPERATION) for s in scopes),
            'U06_ALREADY_PRESENT')
    # Preserve every unrelated entry, exact keys, principal and version.
    target = json.loads(json.dumps(source, ensure_ascii=False))
    target['operations'][OPERATION] = {
        'level': 4,
        'risk': 'critical',
        'requires_second_confirmation': True,
        'one_time_use': True,
        'requested_approver': 'mohammad',
        'expires_seconds': 180,
        'policy_version': ver,
        'rollback_reference': ROLLBACK
    }
    target['typed_scopes'].append({
        'tool': 'host_action_v2_apply',
        'project': 'control_plane',
        'environment': 'production',
        'action': ACTION,
        'risk': 'critical',
        'operation': OPERATION,
        'principals': [{'principal_id': 'mohammad',
                        'roles': ['mcp-operator']}]
    })
    require(len(target['operations']) == len(operations) + 1 and
            len(target['typed_scopes']) == len(scopes) + 1, 'ADDITIVE_ONLY')
    return target


def main():
    require(sys.argv[1:] == ['--preview'], 'ONLY_PREVIEW_SUPPORTED')
    require(socket.getfqdn().lower() == HOST, 'HOST_MISMATCH')
    st = os.lstat(POLICY)
    require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and
            st.st_gid == 0 and not (st.st_mode & 0o022) and
            st.st_nlink == 1 and st.st_size <= 200000, 'OWNER_MODE')
    with open(POLICY, 'rb') as f:
        raw = f.read(200001)
    require(len(raw) == st.st_size and sha(raw) == PINNED,
            'POLICY_PREIMAGE_SHA_DRIFT')
    policy = json.loads(raw.decode('utf-8'))
    out = candidate(policy)
    payload = (json.dumps(out, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    require(sha(payload) == EXPECTED_CANDIDATE_SHA256 and
            len(payload) == EXPECTED_CANDIDATE_SIZE,
            'PRODUCTION_CANDIDATE_SHA_DRIFT')
    report = {
        'schema': 'prhm.u06.approval-policy.readonly-candidate.v1',
        'host': HOST,
        'mode': 'READ_ONLY_NO_WRITE',
        'python_version': sys.version.split()[0],
        'preimage_sha256': PINNED,
        'candidate_sha256': sha(payload),
        'candidate_size': len(payload),
        'owner_confirmed_sha_bound': True,
        'operations_before': len(policy['operations']),
        'operations_after': len(out['operations']),
        'typed_scopes_before': len(policy['typed_scopes']),
        'typed_scopes_after': len(out['typed_scopes']),
        'new_action': ACTION,
        'new_level': 4,
        'new_risk': 'critical',
        'old_policy_modified': False,
        'live_policy_modified': False,
        'action_registered': False,
        'root_executor_installed': False,
        'prod_db_mutated': False
    }
    print(json.dumps(report, sort_keys=True))
    require(sha(open(POLICY, 'rb').read()) == PINNED,
            'POLICY_CHANGED_DURING_READ')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('STOP_' + str(error), file=sys.stderr)
        sys.exit(3)
