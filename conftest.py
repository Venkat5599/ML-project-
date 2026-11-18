"""Put the project root on sys.path so tests import chainsleuth/ and backend/."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
