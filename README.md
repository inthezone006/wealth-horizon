# Wealth Horizon

Wealth Horizon is a personal finance simulation project focused on how investment strategy, portfolio allocation, contribution patterns, and time horizon affect long-term wealth.

## Current State

The repo now contains:

- A modern React + Vite frontend in `frontend/`
- A lightweight Python Flask backend scaffold in `backend/`
- Placeholder routes only; simulation logic has not been implemented yet

## Frontend

The frontend is designed as a polished fintech-style experience with a guidebook, simulator input flow, and forecast placeholder panels.

Run it after installing dependencies:

```bash
cd frontend
npm install
npm run dev
```

## Backend

The backend is a minimal Flask app with placeholder API routes for later integration.

```bash
cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
python app.py
```

## Next Steps

1. Connect the frontend form to the backend API.
2. Add validation and simulation calculation endpoints.
3. Wire charts and results to real scenario data.
