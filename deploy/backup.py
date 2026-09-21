"""Consistent online SQLite backup, retaining seven daily copies on this VPS."""
import os
import sqlite3
from datetime import date
from pathlib import Path

os.umask(0o077)
directory = Path('/opt/gharawi-todo/backups')
directory.mkdir(mode=0o700, exist_ok=True)
destination = directory / f'todo-{date.today().isoformat()}.db'
with sqlite3.connect('file:/opt/gharawi-todo/data/todo.db?mode=ro', uri=True) as source:
    with sqlite3.connect(destination) as backup:
        source.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Backup integrity check failed')
for expired in sorted(directory.glob('todo-????-??-??.db'))[:-7]:
    expired.unlink()
