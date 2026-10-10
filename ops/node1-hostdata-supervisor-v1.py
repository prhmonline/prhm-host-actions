#!/usr/bin/env python3
"""Fixed Node1 host-data schedule supervisor: no VM access, pruning or remote writes.

Modes:
  --preflight  (read-only: source/permissions/disk/host)
  --run        (execute existing Git-pinned snapshot runner, verify, record JSON)
  --check      (read-only: require fresh verified supervised result and capacity)

All output excludes SQL, site content and credentials. Python 3.6 compatible.
"""
import datetime
import hashlib
import json
import os
import pathlib
import re
import socket
import subprocess
import sys
import time

HOST = 'server1.prhm.ir'
ROOT = pathlib.Path('/var/backups/prhm-node1-hostdata-v1')
RUNNER = pathlib.Path('/usr/local/sbin/prhm-node1-hostdata-backup')
VALIDATOR = pathlib.Path('/usr/local/libexec/prhm-node1-host-archive-check-v1.py')
RUNNER_SHA = 'd0230740e7e6fa1aa94407482ef9bd88a5f0a86ca68c4be931af4980bdf1687e'
VALIDATOR_SHA = 'cc3e2cfe121ee08f4460bd02a5c5e869bf699cc6b48bfc11a88d6f8e4f18d819'
LOG_DIR = pathlib.Path('/var/log/prhm-backup-assurance/node1-hostdata-v1')
MIN_FREE_BYTES = 64 * 1024 ** 3
WARNING_FREE_BYTES = 96 * 1024 ** 3
MAX_AGE_HOURS = 36
SNAPSHOT_PATTERN = re.compile(r'^20[0-9]{6}T[0-9]{6}Z$')


def utc():
    return datetime.datetime.now(datetime.timezone.utc)


def iso(d):
    return d.isoformat()


def file_sha(p):
    h = hashlib.sha256()
    with open(str(p), 'rb') as f:
        while True:
            part = f.read(262144)
            if not part:
                break
            h.update(part)
    return h.hexdigest()


def preflight(check_sha=True):
    checks = {}
    checks['node1_hostname'] = socket.gethostname() == HOST
    checks['root_identity'] = os.geteuid() == 0
    checks['snapshot_directory'] = ROOT.is_dir()
    checks['runner_exists'] = RUNNER.is_file() and not RUNNER.is_symlink()
    checks['validator_exists'] = VALIDATOR.is_file() and not VALIDATOR.is_symlink()
    checks['runner_root_only'] = (checks['runner_exists'] and
                                  RUNNER.stat().st_uid == 0 and
                                  RUNNER.stat().st_mode & 0o777 == 0o700)
    checks['validator_root_only'] = (checks['validator_exists'] and
                                     VALIDATOR.stat().st_uid == 0 and
                                     VALIDATOR.stat().st_mode & 0o777 == 0o600)
    checks['runner_matches_git'] = bool(check_sha and checks['runner_exists'] and
                                         file_sha(RUNNER) == RUNNER_SHA)
    checks['validator_matches_git'] = bool(check_sha and checks['validator_exists'] and
                                            file_sha(VALIDATOR) == VALIDATOR_SHA)
    disk_free = 0
    try:
        s = os.statvfs(str(ROOT))
        disk_free = s.f_bavail * s.f_frsize
    except OSError:
        pass
    checks['disk_free_above_64gib'] = disk_free >= MIN_FREE_BYTES
    return {'ready': all(checks.values()), 'checks': checks,
            'disk_free_gib': disk_free // 1024 ** 3,
            'disk_warning_below_96gib': disk_free < WARNING_FREE_BYTES,
            'production_mutation': False}


def parse_manifest(p):
    raw = p.read_text(encoding='utf8')
    d = {}
    for line in raw.splitlines():
        if '=' not in line:
            raise ValueError('INVALID_MANIFEST')
        k, v = line.split('=', 1)
        if not k or k in d:
            raise ValueError('INVALID_MANIFEST')
        d[k] = v
    return d


def verify_snapshot(directory, started, checksum_command=True):
    directory = pathlib.Path(directory)
    if not SNAPSHOT_PATTERN.fullmatch(directory.name) or directory.parent != ROOT:
        raise ValueError('UNEXPECTED_SNAPSHOT_PATH')
    stamp = datetime.datetime.strptime(directory.name, '%Y%m%dT%H%M%SZ')
    stamp = stamp.replace(tzinfo=datetime.timezone.utc)
    if abs((stamp - started).total_seconds()) > 300:
        raise ValueError('SNAPSHOT_NOT_FROM_THIS_EXECUTION')
    if not (directory / 'COMPLETE').is_file():
        raise ValueError('MISSING_COMPLETE')
    m = parse_manifest(directory / 'MANIFEST')
    for key, expected in [
        ('schema', 'prhm.node1-hostdata-snapshot.v1'),
        ('host', HOST),
        ('created_utc', directory.name),
        ('vm_disk_backup_proven', 'false'),
        ('offsite_independence_proven', 'false'),
        ('coverage', 'host_db_and_site_files_only')
    ]:
        if m.get(key) != expected:
            raise ValueError('MANIFEST_BINDING_INCORRECT')
    db_names = (directory / 'db/database_names.txt').read_text(encoding='utf8').splitlines()
    if len(db_names) < 6 or len(set(db_names)) != len(db_names):
        raise ValueError('DB_INVENTORY_MISSING')
    coverage = json.loads((directory / 'files/coverage-proof.json').read_text(encoding='utf8'))
    if (coverage.get('ok') is not True or coverage.get('ratio', 0) < 0.95 or
            coverage.get('site_regular_files', 0) < 1000 or
            coverage.get('archived_site_logical_bytes', 0) <= 1048576):
        raise ValueError('SITE_ARCHIVE_COVERAGE_INVALID')
    if checksum_command:
        p = subprocess.run(['/usr/bin/sha256sum', '-c', 'SHA256SUMS'],
                           cwd=str(directory), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=90)
        if p.returncode:
            raise ValueError('SNAPSHOT_SHA256_MISMATCH')
    return {'snapshot': directory.name,
            'database_count': len(db_names),
            'site_regular_files': coverage['site_regular_files'],
            'site_logical_bytes': coverage['archived_site_logical_bytes'],
            'coverage_ratio': coverage['ratio'],
            'snapshot_sha256_verified': bool(checksum_command)}


def classify_last(report, now, free_bytes, max_age_hours=MAX_AGE_HOURS):
    checks = {
        'result_pass': report.get('status') == 'PASS',
        'backup_exit_zero': report.get('runner_exit_code') == 0,
        'sha_verified': report.get('snapshot_sha256_verified') is True,
        'full_site_coverage': report.get('coverage_ratio', 0) >= 0.95,
        'db_inventory': report.get('database_count', 0) >= 6,
        'snapshot_bound': bool(SNAPSHOT_PATTERN.fullmatch(report.get('snapshot', ''))),
        'disk_above_floor': free_bytes >= MIN_FREE_BYTES,
    }
    try:
        # Node1 runs Python 3.6; datetime.fromisoformat requires Python 3.7.
        timestamp = report['finished_utc']
        # Python 3.6 only accepts timezone offsets without the colon.
        if timestamp[-3:-2] == ':':
            timestamp = timestamp[:-3] + timestamp[-2:]
        stamp = datetime.datetime.strptime(
            timestamp, '%Y-%m-%dT%H:%M:%S.%f%z')
        age_hours = (now - stamp).total_seconds() / 3600.0
        checks['fresh_within_36h'] = 0 <= age_hours <= max_age_hours
    except (TypeError, ValueError, KeyError):
        age_hours = None
        checks['fresh_within_36h'] = False
    return {'ok': all(checks.values()), 'checks': checks,
            'age_hours': round(age_hours, 2) if age_hours is not None else None,
            'disk_free_gib': free_bytes // (1024 ** 3),
            'disk_warning_below_96gib': free_bytes < WARNING_FREE_BYTES,
            'independent_physical_offsite': False,
            'live_vm_backup': False}


def report_write(data, latest=False):
    LOG_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(str(LOG_DIR), 0o700)
    name = utc().strftime('%Y%m%dT%H%M%SZ') + '-' + str(os.getpid()) + '.json'
    target = LOG_DIR / name
    packed = json.dumps(data, sort_keys=True, indent=2) + '\n'
    fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(packed)
        f.flush()
        os.fsync(f.fileno())
    for label in (['last.json', 'latest.json'] if latest else ['last.json']):
        temp = LOG_DIR / ('temporary-' + label + '-' + str(os.getpid()))
        fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(packed)
            f.flush()
            os.fsync(f.fileno())
        os.replace(str(temp), str(LOG_DIR / label))
    return str(target)


def run_backup():
    started = utc()
    before = preflight()
    state = {'schema': 'prhm.node1-hostdata-supervisor.v1',
             'started_utc': iso(started),
             'finished_utc': None,
             'status': 'FAIL',
             'stage': 'preflight',
             'runner_exit_code': None,
             'snapshot': None,
             'snapshot_sha256_verified': False,
             'live_vm_backup': False,
             'independent_physical_offsite': False,
             'production_database_write': False,
             'automated_prune': False}
    try:
        if not before['ready']:
            raise ValueError('PREFLIGHT_BLOCKED')
        state['stage'] = 'backup'
        p = subprocess.run([str(RUNNER), '--run'], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=3300)
        state['runner_exit_code'] = p.returncode
        if p.returncode:
            raise ValueError('SNAPSHOT_RUNNER_FAILED')
        candidates = sorted(p for p in ROOT.iterdir()
                            if p.is_dir() and SNAPSHOT_PATTERN.fullmatch(p.name))
        if not candidates:
            raise ValueError('SNAPSHOT_NOT_FOUND')
        state['stage'] = 'postrun_verify'
        proof = verify_snapshot(candidates[-1], started)
        state.update(proof)
        state['stage'] = 'completed'
        state['status'] = 'PASS'
    except subprocess.TimeoutExpired:
        state['stage'] = 'runner_timeout'
    except Exception as ex:
        # Controlled error categories only. No source paths, SQL or log contents.
        state['failure_category'] = (str(ex) if isinstance(ex, ValueError)
                                     else 'UNEXPECTED_SUPERVISOR_FAILURE')
    state['finished_utc'] = iso(utc())
    evidence = report_write(state, latest=(state['status'] == 'PASS'))
    print('NODE1_HOSTDATA_SUPERVISOR=' + state['status'])
    print('EVIDENCE_FILE=' + evidence)
    return 0 if state['status'] == 'PASS' else 1


def check_latest():
    result = preflight()
    if not result['ready']:
        print(json.dumps({'status': 'FAIL', 'reason': 'PREFLIGHT_BLOCKED',
                          'checks': result['checks']}))
        return 3
    latest = LOG_DIR / 'last.json'
    try:
        report = json.loads(latest.read_text(encoding='utf8'))
        disk = os.statvfs(str(ROOT))
        status = classify_last(report, utc(), disk.f_bavail * disk.f_frsize)
        # Recheck that previously verified snapshot still exists.
        status['checks']['snapshot_still_complete'] = (
            ROOT.joinpath(report.get('snapshot', ''), 'COMPLETE').is_file())
        status['ok'] = all(status['checks'].values())
    except Exception:
        status = {'ok': False, 'reason': 'NO_VALID_SUPERVISOR_PROOF'}
    status['status'] = 'PASS' if status['ok'] else 'FAIL'
    print(json.dumps(status, sort_keys=True))
    return 0 if status['ok'] else 3


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--preflight']:
            p = preflight()
            print(json.dumps(p, sort_keys=True))
            sys.exit(0 if p['ready'] else 3)
        elif sys.argv[1:] == ['--check']:
            sys.exit(check_latest())
        elif sys.argv[1:] == ['--run']:
            sys.exit(run_backup())
        else:
            print('VALID_FIXED_MODES_ONLY', file=sys.stderr)
            sys.exit(2)
    except Exception:
        print('SUPERVISOR_FAIL_CLOSED', file=sys.stderr)
        sys.exit(3)
