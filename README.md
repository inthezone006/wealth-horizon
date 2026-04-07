# Wealth Horizon

Wealth Horizon is a personal finance simulation project focused on how investment strategy, portfolio allocation, contribution patterns, and time horizon affect long-term wealth.

## Current State

The repo now contains:

- A modern React + Vite frontend in `frontend/`
- A lightweight Python Flask backend scaffold in `backend/`
- Placeholder routes only; simulation logic has not been implemented yet

## Frontend

The frontend now includes a full authentication + onboarding + simulator shell:

- Sign in and sign up with Firebase Authentication (email + password)
- Multi-step onboarding flow immediately after account creation
- Onboarding data stored in online Firebase Firestore
- Saved simulation snapshots stored in Firebase Storage and indexed in Firestore
- Signed-in dashboard for Level 1 / Level 2 / Level 3 simulation workflows

Run it after installing dependencies:

```bash
cd frontend
npm install
npm run dev
```

### Firebase setup for frontend auth + onboarding

1. Create a Firebase project in the Firebase Console.
2. In that project, enable Authentication -> Sign-in method -> Email/Password.
3. Create a Web App in Firebase project settings.
4. Enable Firestore Database and Firebase Storage (Start in production or test mode, then add secure rules).
5. Copy the app config values into `frontend/.env`.

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
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
```

When you run `npm run dev`, users can sign in/sign up, complete the multi-step onboarding flow, and persist profile data to Firestore under `users/{uid}`. The dashboard can also save simulation snapshots to Firebase Storage under `users/{uid}/simulations/`.

Suggested Firestore rules for this app:

```rules
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /users/{userId} {
			allow read, write: if request.auth != null && request.auth.uid == userId;
		}

		match /users/{userId}/simulations/{simulationId} {
			allow read, write: if request.auth != null && request.auth.uid == userId;
		}
	}
}
```

Suggested Firebase Storage rules for simulation snapshots:

```rules
rules_version = '2';
service firebase.storage {
	match /b/{bucket}/o {
		match /users/{userId}/simulations/{fileName} {
			allow read, write: if request.auth != null && request.auth.uid == userId;
		}
	}
}
```

## Backend

The backend is a Flask simulation API that validates portfolio inputs and returns deterministic projection data.

```bash
cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
python app.py
```

Available endpoints:

- `GET /api/health` returns service status and version.
- `GET /api/meta` returns the backend description and route map.
- `POST /api/simulate` validates a profile payload and returns a projection with annual balance breakdowns.

Example request body:

```json
{
	"profile": {
		"displayName": "Ava Carter",
		"ageRange": "26-35",
		"primaryGoal": "Financial independence",
		"monthlyContribution": 700,
		"targetHorizonYears": 20,
		"riskLevel": "balanced",
		"strategyMode": "compare-both"
	},
	"marketProbabilities": {
		"recessionProbability": 42,
		"rateCutProbability": 58,
		"spUpProbability": 54
	}
}
```

## Next Steps

1. Connect the frontend form to the backend API.
2. Wire charts and results to real scenario data.
3. Add persistence if you want server-side simulation history.
