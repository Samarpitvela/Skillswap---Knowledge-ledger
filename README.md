# SkillSwap: Peer-to-Peer Knowledge Ledger


## 📋 Project Overview

**SkillSwap** is a decentralized learning platform where students exchange specialized skills (coding, music, languages, design, etc.) using a blockchain-like **Knowledge Credit (KC)** system instead of currency. 

### Core Features:
- 🔐 **JWT Authentication** - Secure user login/registration
- 💳 **Credit Ledger** - Immutable transaction history (PostgreSQL ACID transactions)
- 🔒 **Escrow System** - Defensive programming prevents double-spending of credits
- 📅 **Session Management** - Schedule, track, and rate skill exchange sessions
- ⭐ **Reputation System** - User ratings and feedback
- 📊 **Real-time Dashboard** - View balances, transactions, and upcoming sessions

### Technology Stack:
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla - no frameworks)
- **Backend**: Node.js + Express.js
- **Database**: PostgreSQL (ACID properties for financial integrity)
- **Authentication**: JWT (JSON Web Tokens)
- **Architecture**: RESTful API

---

## 🚀 Quick Start

### Prerequisites:
- Node.js >= 16.0.0
- npm >= 8.0.0
- PostgreSQL >= 12.0
- Git

### Installation:

#### 1. Clone/Download Repository:
```bash
git clone https://github.com/skillswap/skillswap.git
cd skillswap
```

#### 2. Install Backend Dependencies:
```bash
npm install
```

#### 3. Setup PostgreSQL Database:
```bash
# Create database
createdb skillswap_db

# (Optional) Create user
createuser skillswap_user -P
```

#### 4. Create `.env` file in root directory (or copy from `.env.example`):
```env
# Server
PORT=5000
NODE_ENV=development
 
# Supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

#### 5. Start Backend Server:
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server will be available at: `http://localhost:5000`

#### 6. Open Frontend:
- Open `skillswap-frontend.html` in a modern web browser
- Or serve using a local server:
  ```bash
  # Using Python
  python -m http.server 8000
  
  # Using Node (npx)
  npx http-server
  ```

---

## 📁 Project Structure

```
skillswap/
├── server.js                    # Express backend server
├── package.json                 # Node.js dependencies
├── .env                         # Environment variables (CREATE THIS)
├── skillswap-frontend.html      # Single-page application (SPA)
├── skillswap.html               # Static demo version
└── README.md                    # This file
```

---

## 🔗 API Endpoints

### Authentication
```
POST   /api/auth/register        - Create new account
POST   /api/auth/login           - Login with credentials
```

### User Profile
```
GET    /api/users/me/profile     - Current user profile
GET    /api/users/:userId        - Public user profile
```

### Balance & Transactions
```
GET    /api/balance              - Get current credit balance
GET    /api/transactions         - Transaction history (ledger)
```

### Skills
```
GET    /api/skills               - Browse all skills (filter by category/search)
POST   /api/skills               - Create new skill offering
```

### Sessions & Escrow
```
POST   /api/sessions/request     - Request skill session (lock credits in escrow)
POST   /api/sessions/:id/complete - Complete session (release escrow)
GET    /api/sessions             - List user's sessions
```

### Health
```
GET    /api/health               - Server status check
```

---

## 🔐 Security Features

### 1. **Double-Spend Prevention (Defensive Programming)**
```sql
-- Transaction is atomic (all or nothing)
BEGIN;
  SELECT available_credits FROM user_balances WHERE user_id = ? FOR UPDATE;
  -- Check balance is sufficient
  UPDATE user_balances SET available_credits = available_credits - ? ...;
  INSERT INTO credit_transactions ...;
COMMIT;
```

### 2. **JWT Authentication**
- All protected endpoints require valid Bearer token
- Tokens expire after 7 days
- Password hashing with bcryptjs (10 salt rounds)

### 3. **ACID Compliance**
- PostgreSQL transactions ensure data consistency
- Credits locked in escrow cannot be double-spent
- All financial operations are immutable

### 4. **Input Validation**
- Server-side validation on all endpoints
- SQL prepared statements (prevent SQL injection)

---

## 📊 Database Schema

### Users Table
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  enrollment_id VARCHAR(20) UNIQUE,
  full_name VARCHAR(100),
  rating DECIMAL(2,1) DEFAULT 5.0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Credit Transactions (Immutable Ledger)
```sql
CREATE TABLE credit_transactions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  amount INT NOT NULL,
  tx_type VARCHAR(50) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'confirmed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Escrow Vault
```sql
CREATE TABLE escrow (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  skill_id INT NOT NULL,
  amount INT NOT NULL,
  teacher_id INT NOT NULL REFERENCES users(id),
  session_id INT,
  status VARCHAR(20) DEFAULT 'locked',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP
);
```

### Sessions
```sql
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  skill_id INT NOT NULL REFERENCES skills(id),
  student_id INT NOT NULL REFERENCES users(id),
  teacher_id INT NOT NULL REFERENCES users(id),
  scheduled_at TIMESTAMP NOT NULL,
  duration_minutes INT DEFAULT 60,
  status VARCHAR(20) DEFAULT 'pending',
  rating INT,
  feedback TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🧪 Testing the Application

### Test User Account:
```
Username: testuser
Email: test@example.com
Password: Test@123
```

### Test Flow:
1. **Register** a new account
2. **Browse Skills** in Marketplace
3. **Request a Session** (choose a skill, dates will lock credits in escrow)
4. **Check Balance** in Credit Ledger
5. **Complete Session** (simulated - releases escrow)
6. **View Profile** with updated stats

### API Testing with cURL:

```bash
# Register
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"user1","email":"user1@example.com","password":"pass123","full_name":"User One"}'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"user1","password":"pass123"}'

# Get Balance (replace TOKEN with actual JWT)
curl -X GET http://localhost:5000/api/balance \
  -H "Authorization: Bearer TOKEN"

# Browse Skills
curl -X GET "http://localhost:5000/api/skills?category=Technology"

# Get Transactions
curl -X GET http://localhost:5000/api/transactions \
  -H "Authorization: Bearer TOKEN"
```

---

## 📝 UML Diagrams & Documentation

### Use Case Diagram:
```
┌─────────────────────────────────────────────────────┐
│                     SkillSwap System                 │
├─────────────────────────────────────────────────────┤
│                                                       │
│  Student Actor:                                      │
│    ├─ Register/Login                                │
│    ├─ Browse Skills                                 │
│    ├─ Request Session (lock credits)               │
│    ├─ Complete Session (release escrow)            │
│    ├─ View Transaction History                     │
│    └─ Rate Teacher                                  │
│                                                       │
│  Teacher Actor:                                      │
│    ├─ Offer Skills                                  │
│    ├─ Accept Session Requests                       │
│    ├─ Mark Sessions Complete                        │
│    └─ View Earned Credits                           │
│                                                       │
│  System:                                             │
│    ├─ Credit Ledger (immutable)                     │
│    ├─ Escrow Vault                                  │
│    ├─ Balance Management                            │
│    └─ Reputation Tracking                           │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### Class Diagram:
```
┌─────────────────────────────────────────────────────┐
│                     User                             │
├─────────────────────────────────────────────────────┤
│ - id: int                                           │
│ - username: string                                  │
│ - email: string                                     │
│ - password_hash: string                             │
│ - full_name: string                                 │
│ - rating: float                                     │
│ + register()                                        │
│ + login()                                           │
│ + getBalance()                                      │
└─────────────────────────────────────────────────────┘
           ▲                          ▲
           │                          │
        1:N                        1:N
┌──────────────────┐      ┌──────────────────┐
│      Skill       │      │   Transaction    │
├──────────────────┤      ├──────────────────┤
│ - id             │      │ - id             │
│ - name           │      │ - amount         │
│ - cost_credits   │      │ - type           │
│ - teacher_id     │      │ - user_id        │
│ - rating         │      │ - status         │
└──────────────────┘      │ - created_at     │
           ▲               └──────────────────┘
           │
        1:N
┌──────────────────┐
│    Session       │
├──────────────────┤
│ - id             │
│ - skill_id       │
│ - student_id     │
│ - teacher_id     │
│ - scheduled_at   │
│ - status         │
│ - rating         │
└──────────────────┘
           │
           │ 1:1
           └──────────────────┐
                    ┌──────────────────┐
                    │     Escrow       │
                    ├──────────────────┤
                    │ - id             │
                    │ - amount         │
                    │ - session_id     │
                    │ - status         │
                    │ - locked_at      │
                    │ - released_at    │
                    └──────────────────┘
```

### Activity Diagram (Session Flow):
```
START
  │
  ├─→ Student browses skills
  │     │
  │     ├─→ Selects skill & teacher
  │     │
  │     ├─→ [CHECK: Balance >= Cost?]
  │     │  └─ NO → Show insufficient funds ─┐
  │     │  └─ YES → Continue              │
  │     │                                  │
  │     ├─→ Lock credits in ESCROW        │
  │     │     (UPDATE user_balances       │
  │     │      INSERT escrow record)      │
  │     │                                  │
  │     └─→ Create pending session        │
  │                                        │
  ├─→ Teacher reviews & accepts           │
  │                                        │
  ├─→ Session scheduled                   │
  │     │                                  │
  │     ├─→ Session happens               │
  │     │                                  │
  │     ├─→ Both confirm completion       │
  │     │                                  │
  │     ├─→ RELEASE escrow to teacher     │
  │     │     (UPDATE escrow status       │
  │     │      UPDATE user_balances)      │
  │     │                                  │
  │     └─→ Log transactions              │
  │                                        │
  ├─→ Session marked complete             │
  │     │                                  │
  ├─→ Both rate each other                │
  │                                        │
  └─→ END ← Credits successfully transferred
     └─ Back to: Show insufficient funds
```

---

## 🔍 Key Design Patterns Used

### 1. **Defensive Programming**
- Input validation on every endpoint
- ACID transactions for financial operations
- Row-level locking to prevent race conditions

### 2. **Repository Pattern**
- Database queries isolated in functions
- Easy to swap database implementations

### 3. **JWT Authentication Pattern**
- Stateless authentication
- Token-based authorization on protected routes

### 4. **Transaction Ledger Pattern**
- Immutable audit trail
- All credit changes logged
- Easy compliance & debugging

---

## 🛠️ Development Workflow

### Run in Development Mode:
```bash
npm run dev
```
- Auto-restarts on file changes
- Console logs all requests

### Run Tests:
```bash
npm test
```

### Build for Production:
```bash
# Update .env with production values
npm start
```

---



## 📖 References & Standards

- **IEEE Standard for Software Requirements Specification** (SRS format)
- **UML 2.5** (Diagrams & notation)
- **PostgreSQL ACID Properties** (Data integrity)
- **OWASP Security Best Practices** (Authentication, validation)
- **REST API Design Best Practices** (HTTP methods, status codes)

---


## 📝 Future Enhancements

- [ ] Blockchain integration for immutable ledger
- [ ] Real-time notifications (WebSockets)
- [ ] Video call integration for sessions
- [ ] Skill verification certificates
- [ ] Mobile app (React Native)
- [ ] Payment gateway for credit purchases
- [ ] AI-powered skill recommendations
- [ ] Dispute resolution system

---

## ⚖️ License

MIT License - See LICENSE file for details

---

## 📞 Support

For issues or questions:
1. Check the API documentation above
2. Review database schema diagrams
3. Check browser console for errors (F12)
4. Check server logs: `npm run dev`

---

**Happy Skill Swapping! 🚀**
