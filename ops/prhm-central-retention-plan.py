#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys

BUNDLE_RE = re.compile(r"^20[0-9]{6}T[0-9]{6}Z\.restic-repo\.tar$")

def die(msg):
    raise SystemExit("retention_plan_error:" + msg)

def load_inventory(path):
    try:
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
    except Exception as exc:
        die("invalid_inventory:" + str(exc))

    if not isinstance(obj, list):
        die("inventory_not_list")

    names = []
    for item in obj:
        if not isinstance(item, dict):
            die("inventory_item_not_object")

        name = item.get("Path") or item.get("Name")
        if not isinstance(name, str) or not BUNDLE_RE.fullmatch(name):
            die("unexpected_remote_name:" + str(name))

        names.append(name)

    if len(names) != len(set(names)):
        die("duplicate_remote_name")

    return sorted(names)

def load_protected(latest_state):
    if not os.path.isfile(latest_state):
        die("latest_verified_state_missing")

    try:
        with open(latest_state, encoding="utf-8") as f:
            obj = json.load(f)
    except Exception as exc:
        die("latest_state_invalid:" + str(exc))

    if obj.get("status") != "pass":
        die("latest_state_not_pass")

    remote = obj.get("remote")
    if not isinstance(remote, str):
        die("latest_state_remote_invalid")

    name = remote.rsplit("/", 1)[-1]

    if not BUNDLE_RE.fullmatch(name):
        die("latest_state_bundle_invalid")

    return name

def plan(current, latest_state, inventory):
    if not BUNDLE_RE.fullmatch(current):
        die("current_bundle_invalid")

    names = load_inventory(inventory)

    # Existing verified current object => final desired count 7.
    # New upload pending => reduce to <=6 first, then upload returns to 7.
    current_exists = current in names
    limit = 7 if current_exists else 6

    if len(names) <= limit:
        return []

    protected = load_protected(latest_state)

    if protected not in names:
        die("protected_bundle_missing_remote")

    candidates = [
        name for name in names
        if name not in {protected, current}
    ]

    need = len(names) - limit

    if len(candidates) < need:
        die("insufficient_safe_prune_candidates")

    return candidates[:need]

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--current", required=True)
    p.add_argument("--latest-state", required=True)
    p.add_argument("--inventory", required=True)
    args = p.parse_args()

    for item in plan(args.current, args.latest_state, args.inventory):
        print(item)

if __name__ == "__main__":
    main()
