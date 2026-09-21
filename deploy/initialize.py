"""Run once on the VPS; never prints the generated credential."""
import os
import secrets
from pathlib import Path

destination = Path('/opt/gharawi-todo/.env')
descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, 'w') as environment:
    environment.write(f'TODO_SYNC_TOKEN={secrets.token_hex(32)}\n')
    environment.write(f'TODO_PROXY_NETWORK={os.environ["TODO_PROXY_NETWORK"]}\n')
