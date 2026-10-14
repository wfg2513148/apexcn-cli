#!/usr/bin/env python3.11
"""Reuse the OCI API monitor's approved Feishu transport and private store."""
import json
import sys

sys.path.insert(0, "/opt/apexcn-health/current")
from apexcn_health_contract import read_private_json
from apexcn_health_notify import send_event

try:
    event = json.load(sys.stdin)
    credentials = read_private_json(sys.argv[1])
    delivered = send_event(event, credentials, 8)
except Exception:
    delivered = False
print(json.dumps({"delivered": delivered}))
sys.exit(0 if delivered else 1)
