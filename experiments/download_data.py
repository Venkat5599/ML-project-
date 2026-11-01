"""Phase 1: download the Elliptic CSVs and build the cached dataset parquet."""
from chainsleuth.data import build_dataset, download_dataset

if __name__ == "__main__":
    download_dataset()
    build_dataset()
    print("Done. Cached at data/processed/dataset.parquet")
