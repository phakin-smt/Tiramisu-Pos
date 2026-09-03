"""Deployment entrypoint. The application itself lives in backend/server.py.

Vercel finds the Flask app through framework detection, which only looks in a
handful of default locations -- a root-level server.py being one of them, and
the reason this project deployed without any entrypoint configuration before
the backend moved under backend/.

Declaring the entrypoint in pyproject.toml is the documented alternative, but
adding that file switches Vercel's dependency install from requirements.txt to
uv, which then fails without a [project] table. Re-exporting the app here keeps
both the detection and the dependency install on the paths that already work.
"""

import os

from backend.server import app


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.getenv('PORT', '8000')), debug=False)
