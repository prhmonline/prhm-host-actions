#!/usr/bin/env python3
"""Render a fail-closed, reversible Nginx cutover gate for iMotion Admin.

This tool produces a new candidate config only. It never installs, reloads,
touches a flag, or changes the running web server.
"""
import argparse
import hashlib
import os
import re
import sys

DEFAULT_FLAG = "/home/imotion/.deploy-gates/admin-i-motion-ir.cutover"
SERVER_START = (
    "    server {\n"
    "        listen 443 ssl http2;\n"
    "        server_name admin.i-motion.ir;\n"
    "        root /home/imotion/domains/admin.i-motion.ir/public_html/app/web;\n"
)
NEXT_SERVER = (
    "    server {\n"
    "        listen 443 ssl http2;\n"
    "        server_name admin.imotion.ir;\n"
)
ROUTE = (
    "        location / {\n"
    "            if ($request_method = OPTIONS) { return 204; }\n"
)
PHP_ROUTE = (
    "        location ~ \\.php$ {\n"
    "            try_files $uri =404;\n"
)
MARKER = "PRHM_IMOTION_ADMIN_CUTOVER_GATE_V1"


def validate_flag(flag):
    if not re.match(r"^/[A-Za-z0-9_.\-/]+$", flag):
        raise ValueError("flag path must be a safe absolute literal")
    if any(part in ("", ".", "..") for part in flag.split("/")[1:]):
        raise ValueError("flag path contains empty, . or .. segment")
    if flag.startswith("/home/imotion/domains/"):
        raise ValueError("flag must not reside in the served application tree")
    return flag


def render(source, flag=DEFAULT_FLAG):
    flag = validate_flag(flag)
    if MARKER in source:
        raise ValueError("already guarded; refuse double injection")
    if source.count(SERVER_START) != 1 or source.count(NEXT_SERVER) != 1:
        raise ValueError("admin server signature missing or not unique")
    start = source.index(SERVER_START)
    end = source.index(NEXT_SERVER, start + len(SERVER_START))
    segment = source[start:end]
    if segment.count(ROUTE) != 1 or segment.count(PHP_ROUTE) != 1:
        raise ValueError("expected two dynamic routes missing or duplicated")
    clause = (
        "            # BEGIN " + MARKER + "\n"
        "            if (-f " + flag + ") { return 503; }\n"
        "            # END " + MARKER + "\n"
    )
    segment = segment.replace(
        ROUTE, "        location / {\n" + clause +
        "            if ($request_method = OPTIONS) { return 204; }\n"
    )
    segment = segment.replace(
        PHP_ROUTE, "        location ~ \\.php$ {\n" +
        clause + "            try_files $uri =404;\n"
    )
    if segment.count(MARKER) != 4:
        raise AssertionError("unexpected guard marker count")
    return source[:start] + segment + source[end:]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--flag-path", default=DEFAULT_FLAG)
    args = parser.parse_args(argv)
    if not re.match(r"^[0-9a-f]{64}$", args.expected_sha256):
        parser.error("expected SHA256 must be 64 lowercase hex characters")
    infile = os.path.realpath(args.input)
    outfile = os.path.realpath(args.output)
    forbidden = ("/etc/", "/opt/imotion-stack/", "/home/imotion/domains/")
    if infile == outfile or outfile.startswith(forbidden):
        parser.error("output cannot overwrite live/managed configuration")
    if os.path.lexists(args.output):
        parser.error("output already exists; refusing replacement")
    with open(infile, "rb") as handle:
        source = handle.read()
    actual = hashlib.sha256(source).hexdigest()
    if actual != args.expected_sha256:
        parser.error("source SHA256 drift; expected {}, received {}".format(
            args.expected_sha256, actual))
    rendered = render(source.decode("utf-8"), args.flag_path).encode("utf-8")
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(rendered)
    except BaseException:
        os.unlink(args.output)
        raise
    print("RENDER_PASS input_sha256={} output_sha256={} gate={}".format(
        actual, hashlib.sha256(rendered).hexdigest(), args.flag_path))


if __name__ == "__main__":
    main()
