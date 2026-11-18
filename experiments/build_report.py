"""Build report/ChainSleuth_AML_Report.docx from report/REPORT.md.

Refreshes the section-5 tables from results/metrics first (see
experiments/report_tables.py), then converts with pandoc. Figure links in the
markdown are relative to report/, so pandoc runs with report/ as its resource
path and embeds the PNGs from results/figures.

    pip install pypandoc_binary   # bundles pandoc; or have pandoc on PATH
    python -m experiments.build_report
"""
from __future__ import annotations

import shutil
import subprocess
import sys

from chainsleuth.config import REPORT_DIR
from experiments import report_tables

DOCX = REPORT_DIR / "ChainSleuth_AML_Report.docx"


def pandoc_bin() -> str:
    try:
        import pypandoc

        return pypandoc.get_pandoc_path()
    except (ImportError, OSError):
        found = shutil.which("pandoc")
        if not found:
            sys.exit("pandoc not found: pip install pypandoc_binary, or install pandoc")
        return found


def main() -> int:
    report_tables.main([])
    cmd = [
        pandoc_bin(), str(REPORT_DIR / "REPORT.md"),
        "--from", "gfm", "--to", "docx",
        "--resource-path", str(REPORT_DIR),
        "--output", str(DOCX),
    ]
    subprocess.run(cmd, check=True)
    print(f"wrote {DOCX.relative_to(REPORT_DIR.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
