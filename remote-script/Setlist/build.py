"""A fingerprint of this script's files, so the Setlist app can tell when Live runs an old copy.

The app computes the same fingerprint over remote-script/Setlist in the repo
(packages/server/src/scriptBuild.ts) and warns when the two differ.
"""

import hashlib
import os


def script_build(folder=None):
    folder = folder or os.path.dirname(os.path.abspath(__file__))
    digest = hashlib.sha1()
    for name in sorted(n for n in os.listdir(folder) if n.endswith(".py")):
        with open(os.path.join(folder, name), "rb") as f:
            data = f.read().replace(b"\r\n", b"\n")
        digest.update(name.encode("utf-8") + b"\n" + data + b"\n")
    return digest.hexdigest()[:12]
