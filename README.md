# MatChain

MatChain is a materials discovery platform that combines a CrystalVAE-style inverse design workflow with AI model validation and a blockchain-inspired provenance layer.

This repository now includes:

- a Python FastAPI backend that exposes the existing discovery pipeline
- a React + Vite frontend for dashboard and discovery workflows
- a local Ganache-first blockchain workflow for registry and marketplace demo operations
- the original research pipeline preserved in `matchain_colab_corrected.py`

## Quick start

### Backend

Use Python 3.12 for the scientific dependency stack.

```bash
cd backend
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

### Local blockchain

```bash
cd contracts
npm install
npm run compile
npm run node
```

Then in another terminal:

```bash
npm run deploy
```

For the browser workflow, configure MetaMask with RPC `http://127.0.0.1:8545`, chain ID `1337`, currency `ETH`. The local Ganache command uses a publicly known development-only mnemonic so its accounts can be imported into MetaMask; never use these accounts or keys on a public network. Deployment writes `frontend/.env.local` with the matching chain ID, RPC URL, and contract addresses. Restart the Vite server after deployment.

The React registry and marketplace send signed contract calls through MetaMask, wait for mined successful receipts, decode the emitted events, and refresh from those contract addresses. Backend compatibility write endpoints also fail with HTTP 503 rather than changing JSON ledger state when a configured contract is unavailable. Discovery jobs are stored in `backend/data/matchain.sqlite3`; queued/running jobs found after a restart are marked failed with an interruption reason.

IPFS upload uses a Kubo-compatible `IPFS_API_URL` (base URL or `/api/v0` endpoint); optional credentials are supplied with `IPFS_API_AUTH_HEADER`. With no API URL the app stores JSON in `matchain_ipfs_store.json` and uses an explicit `local-sha256:` reference. That fallback is not IPFS and does not provide distributed availability.

## Local Ganache workflow

This project is configured to develop first on a local blockchain so the registry and marketplace remain demonstrable without external services. After deployment, Hardhat writes its contract addresses to `contracts/deployments/localhost.json`; the backend reads this file automatically. The deployment manifest is local/generated and is intentionally not committed.

When the local node is running, start the backend and frontend using the instructions above. Registry and marketplace reads use deployed contract state. Frontend writes are signed by MetaMask; backend write endpoints require an explicitly configured unlocked `BLOCKCHAIN_ACCOUNT`, otherwise they return HTTP 503. Unavailable chain reads return HTTP 503 rather than showing JSON-ledger records as on-chain data.

Run `npm run test` for local Solidity tests and `npm run test:ganache` while Ganache is running for a two-account live JSON-RPC workflow. The live script checks that generated frontend addresses/ABIs match the current deployment.

The registry and marketplace screens in the React frontend load live contract data and support MetaMask-signed registration, listing creation, and local-chain purchases. The old Streamlit prototype remains in `app.py` as a legacy entrypoint; the new user-facing application is the React frontend.

Marketplace authorization is enforced by the contract: only the creator recorded in the registry can list that fingerprint. A purchase is a one-time sale that stores the buyer address and pays the seller; free-text licence terms are recorded but are not legally or technically enforced, and the registry creator record is not transferred.

Discovery results are returned only if they pass the existing geometry, thermodynamic hull-energy, and available-model consensus stages. A run can correctly complete with zero final candidates. Without `MP_API_KEY`, the existing scientific pipeline uses its synthetic dataset fallback; CHGNet/M3GNet are optional and their availability is reported per run. Predictions and computed stability are not experimental verification.

## Authentication & User Profiles (Firebase)

MatChain includes a decentralized researcher authentication and profile system powered by **Firebase Auth** and **Cloud Firestore** (100% free tier / Spark plan):

- **Sign-in Methods**: Email & Password and 1-Click Google Sign-In.
- **Firestore User Profiles**: User documents are stored in the `users/{uid}` collection containing the researcher's full name, academic/research role, institution, and linked MetaMask wallet address.
- **Web3 Wallet Linking**: Connect your MetaMask wallet to link your on-chain materials discovery and registration history with your user account.

### Firebase Free Tier Setup:
1. Go to [Firebase Console](https://console.firebase.google.com/) and create a free project.
2. In **Build > Authentication > Sign-in method**, enable **Email/Password** and **Google**.
3. In **Build > Firestore Database**, click **Create database** (start in test mode for development).
4. In **Project Settings > General**, under *Your apps*, click the **Web (`</>`)** icon to register an app.
5. Copy the configuration credentials into `frontend/.env.local`:
   ```bash
   VITE_FIREBASE_API_KEY=AIzaSy...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project
   VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789...
   VITE_FIREBASE_APP_ID=1:123456789:web:...
   ```
6. Restart the frontend dev server (`npm run dev`).

## Key files

- `matchain_colab_corrected.py` — legacy scientific engine
- `backend/app/main.py` — FastAPI entrypoint
- `backend/app/services/matchain_service.py` — pipeline integration service
- `frontend/src/App.tsx` — React app shell & navigation
- `frontend/src/pages/AuthPage.tsx` — Unified Sign In / Sign Up portal
- `frontend/src/context/AuthContext.tsx` — Firebase auth & Firestore profile provider
- `frontend/src/lib/firebase.ts` — Firebase client initialization
- `contracts/contracts/MatChainRegistry.sol` — blockchain registry demo
- `contracts/contracts/MatChainMarketplace.sol` — marketplace licensing demo

