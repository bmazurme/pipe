"""`python -m lab run <project_dir>`. Importing `lab.domains` here (and nowhere in
`lab.core`) is what makes every domain self-register before the CLI looks any of them
up — core itself never names a domain module.
"""

import sys

import lab.domains  # noqa: F401 — side-effecting import: registers every built-in domain
from lab.core.cli import main

if __name__ == "__main__":
    sys.exit(main())
