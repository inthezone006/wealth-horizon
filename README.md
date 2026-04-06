# Wealth Horizon

Wealth Horizon is a personal finance simulation project focused on how investment strategy, portfolio allocation, contribution patterns, and time horizon affect long-term wealth.

## Current State

The repo now contains:

- A modern React + Vite frontend in `frontend/`
- A lightweight Python Flask backend scaffold in `backend/`
- Placeholder routes only; simulation logic has not been implemented yet

## Frontend

The frontend now includes a focused authentication experience:

- Sign in and sign up with Firebase Authentication (email + password)
- Local session persistence in the browser using Firebase auth persistence
- Account summary panel after login

Run it after installing dependencies:

```bash
cd frontend
npm install
npm run dev
```

### Firebase setup for frontend auth

1. Create a Firebase project in the Firebase Console.
2. In that project, enable Authentication -> Sign-in method -> Email/Password.
3. Create a Web App in Firebase project settings.
4. Copy the app config values into `frontend/.env`.

Create `frontend/.env` from the example:

```bash
cd frontend
copy .env.example .env
```

Then set these values in `frontend/.env`:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef123456
```

When you run `npm run dev`, the sign in/sign up screen will use Firebase Auth and keep users signed in locally in the same browser.

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
