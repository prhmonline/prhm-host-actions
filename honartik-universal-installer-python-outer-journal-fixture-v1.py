#!/usr/bin/env python3
"""Issue 217: NONROOT TEST FIXTURE outer journal for actual pinned Python install_bundle.
Not a Production recovery module, root adapter, CLI, approval consumer or installer.
All effects confined to the pre-existing per-test /tmp/...python-install-fixture-*.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import uuid

SCHEMA = 'prhm.honartik217.python-outer-fixture.v1'
def deny(reason):
    raise RuntimeError('honartik217_outer_' + reason)
def sha(data):
    return hashlib.sha256(data).hexdigest()
def fixture(root):
    if not hasattr(os, 'getuid') or os.getuid() == 0:
        deny('nonroot_only')
    if not isinstance(root, Path) or not root.is_absolute() or (
        root.parent != Path(tempfile.gettempdir()).resolve() or
        not root.name.startswith('prhm-honartik217-python-install-fixture-')):
        deny('outside_fixture')
    s = root.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid() or (
        stat.S_IMODE(s.st_mode) != 0o700):
        deny('owner_or_mode')
def sync_dir(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
def atomic(path, content):
    tmp = path.parent / ('.fixture-stage-' + uuid.uuid4().hex)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)
    sync_dir(path.parent)
def names(root):
    return root / 'managed', root / 'outer.lock', root / 'outer.journal'
def observed(prefix, installer):
    ptr = prefix / 'current'
    if not ptr.is_symlink():
        deny('pointer_missing')
    target = ptr.resolve(strict=True)
    if target.parent != prefix / 'versions' or len(target.name) != 64:
        deny('pointer_escape')
    if installer.bundle_digest(target) != target.name:
        deny('bundle_tampered')
    manifest = (prefix / 'installation.json').read_bytes()
    wrapper = (prefix / 'deploy-project').read_bytes()
    if json.loads(manifest).get('digest') != target.name:
        deny('manifest_drift')
    return dict(digest=target.name, manifest=manifest, wrapper=wrapper,
                manifest_mode=stat.S_IMODE((prefix / 'installation.json').stat().st_mode),
                wrapper_mode=stat.S_IMODE((prefix / 'deploy-project').stat().st_mode))
def prepare(root, installer, old, new):
    fixture(root)
    prefix, lock, journal = names(root)
    if journal.exists():
        deny('prior_journal')
    before = observed(prefix, installer)
    if (before['digest'] != old or old == new or
        installer.bundle_digest(root / 'source-two') != new):
        deny('preimage_or_source_drift')
    fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        data = dict(schema=SCHEMA, state='PREPARED', old=old, new=new)
        for item in ('manifest', 'wrapper'):
            data[item + '_b64'] = base64.b64encode(before[item]).decode()
            data[item + '_sha'] = sha(before[item])
            data[item + '_mode'] = before[item + '_mode']
        atomic(journal, (json.dumps(data, sort_keys=True) + '\n').encode())
        os.fsync(fd)
        sync_dir(root)
    finally:
        # Indeterminate fsync/rename: keep lock even on exception.
        os.close(fd)
def read(root):
    fixture(root)
    _, _, journal = names(root)
    st = journal.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or (
        stat.S_IMODE(st.st_mode) != 0o600 or st.st_nlink != 1):
        deny('unsafe_journal')
    data = json.loads(journal.read_bytes())
    if (data.get('schema') != SCHEMA or
        data.get('state') not in ('PREPARED', 'COMMITTED', 'ROLLED_BACK') or
        not all(isinstance(data.get(k), str) and len(data[k]) == 64 for k in ('old','new')) or
        data['old'] == data['new']):
        deny('invalid_journal')
    before = {}
    for item in ('manifest', 'wrapper'):
        raw = base64.b64decode(data[item + '_b64'], validate=True)
        if sha(raw) != data[item + '_sha']:
            deny('preimage_corrupt')
        before[item] = raw
    return data, before
def unlock(root):
    _, lock, _ = names(root)
    s = lock.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or (
        stat.S_IMODE(s.st_mode) != 0o600):
        deny('unsafe_lock')
    lock.unlink()
    sync_dir(root)
def commit(root, installer, crash=False):
    fixture(root)
    prefix, lock, journal = names(root)
    data, _ = read(root)
    if data['state'] != 'PREPARED' or not lock.is_file():
        deny('not_prepared')
    after = observed(prefix, installer)
    if after['digest'] != data['new'] or (
            json.loads(after['manifest']).get('previous') != data['old']):
        deny('postimage_drift')
    data['state'] = 'COMMITTED'
    for item in ('manifest', 'wrapper'):
        data['post_' + item + '_sha'] = sha(after[item])
        data['post_' + item + '_mode'] = after[item + '_mode']
    atomic(journal, (json.dumps(data, sort_keys=True) + '\n').encode())
    if crash:
        os._exit(94)
    unlock(root)
def recover(root, installer):
    fixture(root)
    prefix, lock, journal = names(root)
    data, before = read(root)
    if data['state'] == 'COMMITTED':
        after = observed(prefix, installer)
        if after['digest'] != data['new'] or (
            json.loads(after['manifest']).get('previous') != data['old']):
            deny('committed_drift')
        for item in ('manifest', 'wrapper'):
            if sha(after[item]) != data['post_' + item + '_sha'] or (
                after[item + '_mode'] != data['post_' + item + '_mode']):
                deny('committed_drift')
        if lock.exists():
            unlock(root)
        return dict(committed=True, rolled_back=False, digest=data['new'])
    if data['state'] == 'ROLLED_BACK':
        after = observed(prefix, installer)
        if after['digest'] != data['old'] or any(
                after[item] != before[item] for item in ('manifest','wrapper')):
            deny('restored_drift')
        return dict(already_recovered=True, rolled_back=True, digest=data['old'])
    if not lock.is_file():
        deny('lock_absent')
    current = observed(prefix, installer)['digest'] if (
        json.loads((prefix / 'installation.json').read_bytes()).get('digest') ==
        (prefix / 'current').resolve().name) else (prefix / 'current').resolve().name
    if current not in (data['old'], data['new']):
        deny('unexpected_pointer')
    olddir = prefix / 'versions' / data['old']
    if installer.bundle_digest(olddir) != data['old'] or (
            json.loads(before['manifest']).get('digest') != data['old']):
        deny('old_preimage_tampered')
    temp = prefix / ('.recover-' + uuid.uuid4().hex)
    temp.symlink_to(olddir)
    os.replace(temp, prefix / 'current')
    sync_dir(prefix)
    for item, name in (('manifest','installation.json'),('wrapper','deploy-project')):
        installer.atomic_write(prefix / name, before[item], data[item + '_mode'])
    sync_dir(prefix)
    after = observed(prefix, installer)
    if after['digest'] != data['old'] or any(
        after[item] != before[item] or after[item + '_mode'] != data[item + '_mode']
        for item in ('manifest', 'wrapper')):
        deny('rollback_unverified')
    data['state'] = 'ROLLED_BACK'
    atomic(journal, (json.dumps(data, sort_keys=True) + '\n').encode())
    unlock(root)
    return dict(rolled_back=True, exact_bytes_restored=True, digest=data['old'])
