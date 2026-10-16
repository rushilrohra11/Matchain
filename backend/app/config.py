import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
MP_API_KEY = os.getenv("MP_API_KEY", "")
GANACHE_RPC_URL = os.getenv("GANACHE_RPC_URL", "http://127.0.0.1:8545")
GANACHE_CHAIN_ID = int(os.getenv("GANACHE_CHAIN_ID", "1337"))
IPFS_API_URL = os.getenv("IPFS_API_URL", "")
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", str(PROJECT_ROOT / "backend" / "data" / "matchain.sqlite3")))
