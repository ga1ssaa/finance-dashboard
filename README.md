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

- Authentication
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

`VITE_API_BASE_URL` defaults to `http://127.0.0.1:8000/api/v1`. The client accepts loopback API URLs only; use the backend CORS configuration for a different local frontend port. Restart Vite after changing its environment. This is a local, single-owner application without authentication; do not expose it publicly.

Transactions and subscriptions are paginated and filtered by the server. Dashboard cards and category charts use full-set backend aggregates, and recurring costs use the backend subscription summary. Successful mutations invalidate active views. Offline/API errors show retry controls and never fall back to demo records. Forms remain open with their input on failed saves.

All persisted monetary values are canonical USD decimal strings with up to eight fractional digits. Display currency is an API preference; rates and theme remain browser-local. Forms freeze their currency/rate when opened. Unchanged monetary inputs preserve their exact canonical value; changed inputs use exact decimal conversion and reject conversions requiring more than eight USD decimal places. Choose USD for values that cannot be represented exactly after conversion. Manual budget income, needs, wants, and savings inputs remain independent from transactions.

Existing financial localStorage data is neither imported nor changed. Backup, restore, and reset controls are disabled for API-managed data. No automatic migration from browser storage is performed.

Validation (Node.js 24 for the built-in TypeScript test loader):

```bash
npm run lint
npm run build
node --test tests/phase4.test.mjs
```

The opt-in live HTTP test in `tests/phase4-api.test.mjs` requires the disposable test API started by `tests/phase4_server.py` and its pagination seed. It uses port 18084 and the generated temporary database, never the normal development API. Once that isolated fixture is ready, run:

```bash
RUN_PHASE4_E2E=1 node --test tests/phase4-api.test.mjs
```
