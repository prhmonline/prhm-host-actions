#!/usr/bin/env python3
"""Validate a Node1 host-data archive without extraction or reading file contents.
Python 3.6+. Input: zstd-compressed POSIX tar produced from Node1 root.
Exit 0 only when actual imotion site regular-file payload is covered.
"""
import json
import os
import pathlib
import subprocess
import sys
import tarfile

SITE_PREFIX = 'home/imotion/domains/'
MIN_RATIO = 0.95


def analyze(members, expected_site_bytes):
    if not isinstance(expected_site_bytes, int) or expected_site_bytes < 1024:
        raise ValueError('SITE_SOURCE_BYTES_INVALID')
    payload = 0
    site_count = 0
    entries = 0
    for entry in members:
        entries += 1
        if entries > 5000000:
            raise ValueError('ARCHIVE_TOO_MANY_ENTRIES')
        name = entry.name
        parts = pathlib.PurePosixPath(name).parts
        if not parts or '..' in parts or name.startswith('/') or '\\' in name:
            raise ValueError('UNSAFE_TAR_PATH')
        if not (entry.isfile() or entry.isdir() or entry.issym() or entry.islnk()):
            raise ValueError('UNSUPPORTED_TAR_ENTRY')
        if name.startswith(SITE_PREFIX) and entry.isfile():
            payload += entry.size
            site_count += 1
    ratio = payload / float(expected_site_bytes)
    return {'ok':site_count > 0 and ratio >= MIN_RATIO and ratio <= 1.1,
            'site_regular_files':site_count,
            'archived_site_logical_bytes':payload,
            'source_site_logical_bytes':expected_site_bytes,
            'ratio':round(ratio, 5),'entry_count':entries}


def inspect(archive, expected_site_bytes):
    p = subprocess.Popen(['/usr/bin/zstd', '-dc', archive],
                         stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    try:
        with tarfile.open(fileobj=p.stdout, mode='r|') as tf:
            result = analyze(tf, expected_site_bytes)
        status = p.wait(timeout=120)
        if status:
            raise ValueError('ARCHIVE_DECOMPRESSION_FAILURE')
        return result
    finally:
        if p.poll() is None:
            p.kill()
            p.wait()


if __name__ == '__main__':
    if len(sys.argv) != 3 or not sys.argv[2].isdigit() or not os.path.isfile(sys.argv[1]):
        print('EXPECTED_FIXED_ARCHIVE_AND_SOURCE_BYTES',file=sys.stderr)
        sys.exit(2)
    try:
        result=inspect(sys.argv[1],int(sys.argv[2]))
        print(json.dumps(result,sort_keys=True))
        sys.exit(0 if result['ok'] else 3)
    except Exception:
        print(json.dumps({'ok':False,'error':'ARCHIVE_VALIDATION_FAILED'}))
        sys.exit(3)
