#!/usr/bin/env -S uv run
"""Project Agent Notes redline entry; implementation lives in the vendored skill."""
import os
import subprocess
import sys
from pathlib import Path

# Agent Notes: 门禁入口必须指向真实实现
# .agents/notes/implemented/process/2026-10-08-gate-entry-must-point-at-real-implementation.md
repo = Path(subprocess.check_output(['git', '-C', str(Path(__file__).parent), 'rev-parse', '--show-toplevel'], text=True).strip())
# Agent Notes: 门禁入口必须指向真实实现; HXLoLis 接入 Agent Notes v2
# 
# 
# Agent Notes: HXLoLis 接入 Agent Notes v2
# .agents/notes/implemented/process/2026-10-08-repository-agent-notes-v2-adoption.md
gate = repo / '.agents/skills/hx-agent-notes/scripts/redline'
os.execvp('uv', ['uv', 'run', '--with-requirements', str(gate / 'requirements.txt'), 'python', str(gate / 'verify.py'), '--repo', str(repo), *sys.argv[1:]])
