# 💰 Finance Dashboard

A modern personal finance dashboard built with **React**, **TypeScript**, and **Tailwind CSS**.

Track your income and expenses, manage budgets, monitor subscriptions, analyze spending with interactive charts, and receive smart financial insights — all in one responsive dashboard.

---

## 📸 Preview

### Dashboard
![Dashboard](./src/screenshots/dashboard.png)

### Transactions
![Transactions](./src/screenshots/transactions.png)

### Budget Management
![Budget](./src/screenshots/budget.png)

### Subscriptions
![Subscriptions](./src/screenshots/subscriptions.png)

### Settings
![Settings](./src/screenshots/settings.png)

### Smart Insights
![Insights](./src/screenshots/insights.png)

### Dark Mode
![Dark Mode](./src/screenshots/dark-mode.png)

---

# ✨ Features

## 📊 Dashboard

- Financial overview
- Total balance
- Monthly income
- Monthly expenses
- Savings tracking
- Interactive analytics

---

## 💸 Transaction Management

- Add transactions
- Edit transactions
- Delete transactions
- Income & Expense types
- Category management
- Currency support
- Date selection

---

## 📈 Analytics

- Expense distribution (Pie Chart)
- Income vs Expense trends
- Monthly statistics
- Time range filters
- Smart financial insights

---

## 🎯 Budget Management

- Category budgets
- Budget progress tracking
- 80% warning indicator
- Overspending detection
- Financial goals

---

## 🔁 Subscription Tracker

Manage recurring payments like:

- Spotify
- Netflix
- Gym
- Internet
- Mobile
- Other subscriptions

Includes:

- Monthly cost
- Next payment date
- Active subscriptions overview

---

## ⚙️ Settings

Customize your dashboard experience:

- Dark / Light theme
- API-managed display currency
- Browser-local theme and exchange-rate cache
- Disabled legacy reset and backup controls
- User preferences

---

## 🌙 User Experience

- Responsive design
- Dark / Light mode
- Modern UI
- Mobile friendly
- Clean component architecture

---

# 📂 Project Structure

```
src/
│
├── components/
├── pages/
├── hooks/
├── types/
├── utils/
├── data/
├── constants/
├── assets/
└── App.tsx
```

---

# ⚙️ Installation

Clone the repository

```bash
git clone https://github.com/ga1ssaa/finance-dashboard.git
```

Go to project

```bash
cd finance-dashboard
```

Install dependencies

```bash
npm install
```

Run development server

```bash
npm run dev
```

Build production version

```bash
npm run build
```

---

# 📱 Responsive Design

The application is optimized for

- 💻 Desktop
- 📱 Mobile
- 📟 Tablet

---

# 🧠 Project Highlights

- Modular architecture
- Reusable components
- Custom React Hooks
- Strong TypeScript typing
- Responsive layout
- Interactive charts
- FastAPI persistence
- Clean UI/UX
- Feature-based organization

---

# 🚀 Future Improvements

- Cloud database
- Multi-currency support
- Export to PDF
- CSV import/export
- Notifications
- Recurring transactions
- AI financial recommendations

---

# 📄 License

This project is licensed under the MIT License.

---

# 👨‍💻 Author

**Gaisa Aldiyar**

Software Engineering Student

Astana IT University

GitHub:
https://github.com/ga1ssaa
## Local full-stack development

Financial records, manual budget inputs, and display-currency preferences now use the FastAPI API. Run the backend using [backend/README.md](backend/README.md), then configure and start this frontend:

```bash
cp -n .env.example .env.local
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

`VITE_API_BASE_URL` defaults to `http://127.0.0.1:8000/api/v1`. The client accepts loopback API URLs only; use the backend CORS configuration for a different local frontend port. Restart Vite after changing its environment. This is a local authenticated application; do not expose this development setup publicly. Use `127.0.0.1` for both Vite and the API (or `localhost` for both) so the host-only refresh cookie works across their ports.

Sign in at `/login` or create an account at `/register`. New registrations start with an empty account. Existing records in the former single-owner namespace are not automatically assigned to registered users.

Access JWTs live only in application memory. Reloading restores the session using the server's HttpOnly refresh cookie. Auth cookie requests include credentials and the required CSRF protection header; ordinary financial requests use the access token. Logout clears the in-memory financial views, drafts, and session and revokes the cookie session. If server logout cannot be confirmed, the app remains gated with a retry action.

Refresh is shared across simultaneous requests in one tab, and cookie-changing operations are serialized. A confirmed authentication rejection may refresh and retry a financial request once. Network failures and ambiguous writes are never automatically retried. Account changes invalidate pending responses before they can populate another account's view.

Multiple tabs share a refresh cookie but do not coordinate refresh rotation. Simultaneous refreshes across tabs may expire the session and require signing in again. Use one active tab for this local setup.

Transactions and subscriptions are paginated and filtered by the server. Dashboard cards and category charts use full-set backend aggregates, and recurring costs use the backend subscription summary. Successful mutations invalidate active views. Offline/API errors show retry controls and never fall back to demo records. Forms remain open with their input on failed saves.

All persisted monetary values are canonical USD decimal strings with up to eight fractional digits. Display currency is an API preference; rates and theme remain browser-local. Forms freeze their currency/rate when opened. Unchanged monetary inputs preserve their exact canonical value; changed inputs use exact decimal conversion and reject conversions requiring more than eight USD decimal places. Choose USD for values that cannot be represented exactly after conversion. Manual budget income, needs, wants, and savings inputs remain independent from transactions.

Settings → Export Backup downloads the authenticated account's complete financial snapshot from `GET /api/v1/data/export`. The versioned JSON contains canonical USD decimal strings, calendar dates, nullable budget/preferences, and no internal IDs or authentication data. Export uses a consistent read-only snapshot, independent of the current list page. Limits are 10,000 transactions, 1,000 subscriptions and 5 MiB of JSON; oversized exports fail explicitly rather than truncating data. Downloaded files contain unencrypted financial data and should be stored privately.

Existing financial localStorage data is neither imported nor changed. Import, reset and legacy migration remain disabled. No automatic migration from browser storage is performed. This user JSON download is separate from the private administrative PostgreSQL backup/restore tools.

Validation (Node.js 24 for the built-in TypeScript test loader):

```bash
npm run lint
npm run build
node --test tests/phase4.test.mjs tests/phase5-auth.test.mjs tests/phase6-export.test.mjs
```

`tests/phase4-api.test.mjs` and its fixture describe the earlier unauthenticated integration phase; they are historical and are superseded by the authenticated Phase 5 checks. Do not point a historical fixture at normal development data.
