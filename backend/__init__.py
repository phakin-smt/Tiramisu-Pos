"""Flask backend package.

Vercel imports the application as ``backend.server:app`` (declared in
pyproject.toml). That import puts the project root on ``sys.path`` but not this
directory, while the modules in here import each other by plain name
(``from database import ...``) so that they also work when run as ordinary
scripts -- ``python backend/server.py`` -- and when the test suite runs from
inside this directory.

Adding this directory to ``sys.path`` here makes both entry paths resolve
against one set of imports, instead of maintaining package-relative and
script-style imports side by side.
"""

import sys
from pathlib import Path

_BACKEND_ROOT = str(Path(__file__).resolve().parent)
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)
