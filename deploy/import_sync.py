#!/usr/bin/env python3
"""Import an encoded sync batch without putting the private token in shell history."""

import base64
import json
import os
import subprocess
import urllib.request


def sync(url, token, payload):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)


token = next(
    line.split("=", 1)[1].strip()
    for line in open("/opt/gharawi-todo/.env", encoding="utf-8")
    if line.startswith("TODO_SYNC_TOKEN=")
)
ip = subprocess.check_output(
    ["docker", "inspect", "-f", "{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}", "gharawi-todo-todo-1"],
    text=True,
).strip()
url = f"http://{ip}:8080/api/sync"
batch = json.loads(base64.b64decode(os.environ["IMPORT_B64"]))
snapshot = sync(url, token, {"schema": 2, "cursor": 0, "changes": [], "collections": []})
batch["cursor"] = snapshot["cursor"]
if os.environ.get("IMPORT_UPDATE_EXISTING") == "1":
    revisions = {record["id"]: record["revision"] for record in snapshot["records"]}
    collection_revisions = {record["id"]: record["revision"] for record in snapshot["collections"]}
    for record in batch["changes"]:
        record["revision"] = revisions.get(record["id"], 0)
    for record in batch["collections"]:
        record["revision"] = collection_revisions.get(record["id"], 0)
result = sync(url, token, batch)
print(json.dumps({
    "cursor": result["cursor"],
    "tasks_sent": len(batch["changes"]),
    "collections_sent": len(batch["collections"]),
    "task_conflicts": len(result["conflicts"]),
    "collection_conflicts": len(result["collection_conflicts"]),
}))
