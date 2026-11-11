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


# Actual Root-controlled source fingerprints measured by owner on
# prhm-production; this tool can only inspect and refuse drift.
OWNER_SOURCES = {
    'agent_api': (
        '/opt/prhm-agent-selfmaint/server.js',
        '57828b344aca1d1fb51e74cc2c64094edb03c5fd86fe68420d7185f0d12b6530',
        34605, 0o644
    ),
    'root_executor': (
        '/opt/prhm-agent-selfmaint-exec/server.js',
        '4c136a210681ee07a45d96d38d91c1253afcce67feed0a9d062f9f14d0557169',
        115918, 0o755
    ),
    'agent3_mcp': (
        '/home/agent/ssh-mcp-server/src/plugins/hostActionsV2.js',
        '0c6a74757696a0d85840a0aec1bc53c91431481024f2be56e4ecb02f789073ef',
        12321, 0o600
    )
}
API_REGISTRY = ("  host_action_v2_installer_v1: { operation: "
                "'host_action.host_action_v2_installer_v1', rollback: "
                "'host-action-v2:host-action-v2-installer-v1:four-file-restore' },")
EXEC_REGISTRY = ("  host_action_v2_installer_v1:{operation:"
                 "'host_action.host_action_v2_installer_v1',"
                 "kind:'host_action_v2_installer_v1'},")
MC_ENUM = 'const HostActionV2=z.enum(['
ROOT_DISPATCH = 'applyHostActionV2=async function(action){'
AUTH_CONSUME = ("const authz=await callBase("
                "'/v2/host-actions/authorize-consume','POST',"
                "{action,approval_token:token});")
EXEC_APPLY = 'const result=await applyHostActionV2(action);'
DENY = ("if(action==='" + ACTION +
        "')throw new Error('u06_native_root_dispatch_not_installed');")
NEW_API = ("  " + ACTION + ": { operation: '" + OPERATION +
           "', rollback: '" + ROLLBACK + "' },")
NEW_EXEC = ("  " + ACTION + ":{operation:'" + OPERATION +
            "',kind:'" + ACTION + "'},")
NEW_MCP = "'" + ACTION + "',"


def read_exact_root(path, pin, size, mode):
    """Check root ownership, no symlink and inode stability, read only."""
    original = os.lstat(path)
    require(stat.S_ISREG(original.st_mode) and
            original.st_uid == 0 and original.st_gid == 0 and
            stat.S_IMODE(original.st_mode) == mode and
            original.st_nlink == 1 and original.st_size == size,
            'OWNER_SOURCE_TRUST_DRIFT')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        require(opened.st_dev == original.st_dev and
                opened.st_ino == original.st_ino and
                opened.st_size == original.st_size and
                opened.st_uid == 0 and opened.st_gid == 0 and
                stat.S_IMODE(opened.st_mode) == mode,
                'OWNER_SOURCE_RACED')
        with os.fdopen(fd, 'rb', closefd=False) as f:
            raw = f.read(size + 1)
        require(len(raw) == size and sha(raw) == pin,
                'OWNER_SOURCE_SHA_DRIFT')
        return raw
    finally:
        os.close(fd)


def audit_routes(read_sources):
    """Pure in-memory route review; actual Root file checks happen at call site."""
    require(set(read_sources) == set(OWNER_SOURCES), 'ROUTE_SOURCE_SHAPE')
    try:
        api = read_sources['agent_api'].decode('utf-8')
        exe = read_sources['root_executor'].decode('utf-8')
        mcp = read_sources['agent3_mcp'].decode('utf-8')
    except (UnicodeDecodeError, AttributeError):
        raise ValueError('U06_L4_POLICY_PREVIEW_OWNER_NOT_UTF8')
    for text, anchor in [
        (api, API_REGISTRY), (exe, EXEC_REGISTRY),
        (mcp, MC_ENUM), (exe, ROOT_DISPATCH),
        (exe, AUTH_CONSUME), (exe, EXEC_APPLY),
        (api, 'const HOST_ACTION_V2_LEVEL3 = new Set('),
        (api, 'function hostActionV2ApprovalMeta(action)'),
        (exe, 'host_actions_v2: Object.keys(HOST_ACTION_V2_SPECS)')
    ]:
        require(text.count(anchor) == 1, 'ROUTE_ANCHOR_MISSING_OR_DUPLICATE')
    require(ACTION not in api and ACTION not in exe and ACTION not in mcp,
            'ROUTE_U06_ALREADY_REGISTERED')
    require(exe.index(AUTH_CONSUME) < exe.index(EXEC_APPLY),
            'APPROVAL_MUST_PRECEDE_DISPATCH')
    start = api.index('const HOST_ACTION_V2_LEVEL3 = new Set(')
    end = api.index('function hostActionV2ApprovalMeta(action)')
    require(start < end and ACTION not in api[start:end],
            'U06_MUST_NOT_BE_LEVEL3')
    candidates = {
        'agent_api': api.replace(API_REGISTRY, NEW_API + '\n' + API_REGISTRY),
        'root_executor': exe.replace(
            EXEC_REGISTRY, NEW_EXEC + '\n' + EXEC_REGISTRY
        ).replace(ROOT_DISPATCH, ROOT_DISPATCH + DENY),
        'agent3_mcp': mcp.replace(MC_ENUM, MC_ENUM + NEW_MCP)
    }
    require(candidates['root_executor'].count(DENY) == 1,
            'FINAL_DISPATCH_NOT_DENIED')
    require(candidates['root_executor'].index(AUTH_CONSUME) <
            candidates['root_executor'].index(EXEC_APPLY),
            'AUTH_ORDER_CHANGED')
    level3_start = candidates['agent_api'].index(
        'const HOST_ACTION_V2_LEVEL3 = new Set(')
    level3_end = candidates['agent_api'].index(
        'function hostActionV2ApprovalMeta(action)')
    require(ACTION not in candidates['agent_api'][level3_start:level3_end],
            'LEVEL3_PROMOTION')
    return {key: sha(value.encode('utf-8'))
            for key, value in candidates.items()}


def inspect_all_routes():
    files = {key: read_exact_root(*info)
             for key, info in OWNER_SOURCES.items()}
    first = {key: sha(blob) for key, blob in files.items()}
    proposed = audit_routes(files)
    # Check no source changed between the fingerprint and result generation.
    for key, info in OWNER_SOURCES.items():
        require(sha(read_exact_root(*info)) == first[key],
                'OWNER_SOURCE_CHANGED_DURING_READ')
    return {
        'owner_preimage_sha256': first,
        'candidate_sha256': proposed,
        'candidate_root_dispatch_deny_only': True,
        'existing_authorize_consume_before_apply': True,
        'registration_source_written': False,
        'registered_action_ready_to_execute': False,
        'production_installer_authorized': False
    }


def main():
    require(sys.argv[1:] in (['--preview'], ['--audit-all']), 'ONLY_READONLY_AUDIT_SUPPORTED')
    require(socket.getfqdn().lower() == HOST, 'HOST_MISMATCH')
    raw = read_exact_root(POLICY, PINNED, 31167, 0o644)
    # read_exact_root() already validates exact length, SHA, owner and inode.
    # Do not use the obsolete `st` variable from the replaced lstat path.
    require(len(raw) == 31167 and sha(raw) == PINNED,
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
    if sys.argv[1:] == ['--audit-all']:
        report['four_owner_inmemory_preview'] = inspect_all_routes()
    require(sha(read_exact_root(POLICY, PINNED, 31167, 0o644)) == PINNED,
            'POLICY_CHANGED_DURING_READ')
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('STOP_' + str(error), file=sys.stderr)
        sys.exit(3)
