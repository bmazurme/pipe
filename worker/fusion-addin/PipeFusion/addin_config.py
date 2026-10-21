"""The file the worker reads to find this add-in: a port on 127.0.0.1 and a random token, readable by this user only."""

import json
import os
import secrets

DEFAULT_PORT = 47615


def config_path(environ=None, home=None):
    environ = os.environ if environ is None else environ
    custom = (environ.get("PIPE_FUSION_CONFIG") or "").strip()
    if custom:
        return custom
    return os.path.join(home or os.path.expanduser("~"), ".pipe-fusion", "config.json")


def load_token(path):
    """The token of an earlier start, so a running worker keeps working after Fusion restarts; a new one when there is none."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            token = json.load(handle).get("token")
        if isinstance(token, str) and len(token) >= 32:
            return token
    except (OSError, ValueError, AttributeError):
        pass
    return secrets.token_urlsafe(32)


def write_config(path, port, token):
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    temporary = path + ".tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump({"port": port, "token": token}, handle)
    os.replace(temporary, path)


def remove_config(path):
    try:
        os.remove(path)
    except OSError:
        pass
