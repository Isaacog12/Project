# Backend Documentation — Veritas Secure

## Overview

The backend is a **Node.js + Express.js REST API server** that acts as the bridge between the frontend UI and the Ethereum blockchain. It handles certificate issuance, verification, PDF generation, file uploads, authentication, and database management. The server runs on **http://localhost:5000**.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| **Node.js** | JavaScript runtime |
| **Express.js** | Web framework for REST APIs |
| **Ethers.js v6** | Blockchain interaction (Ethereum) |
| **Better-SQLite3** | Local SQLite database for off-chain data |
| **PDF-Lib** | PDF generation and manipulation |
| **QRCode** | QR code generation |
| **JWT (jsonwebtoken)** | Admin authentication tokens |
| **Multer** | File upload handling |
| **Helmet** | Security HTTP headers |
| **express-rate-limit** | Brute-force protection |
| **express-validator** | Input validation |
| **CORS** | Cross-origin resource sharing |

---

## Project Structure

```
backend/
├── server.js              # Main server file (1,239 lines — entire backend)
├── .env                   # Environment variables (private)
├── .env.example           # Template for environment variables
├── package.json           # Dependencies and scripts
├── certificates.db        # SQLite database file (auto-created)
├── check-db.js            # Database inspection utility
├── check-health.js        # Health check utility
├── middleware/             # Custom middleware (if any)
├── assets/                # Logo files for PDF certificates
│   ├── logo1.jpg          # University logo variant 1
│   └── logo2.jpg          # University logo variant 2
├── uploads/               # Uploaded certificate documents
└── templates/             # PDF/email templates
```

---

## Environment Variables

The backend requires these environment variables in a `.env` file:

```env
PORT=5000                                                    # Server port
FRONTEND_URL=http://localhost:3000                          # Frontend URL (for CORS & QR codes)
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY      # Alchemy Ethereum RPC endpoint
PRIVATE_KEY=your_wallet_private_key                         # MetaMask wallet private key
CONTRACT_ADDRESS=0x...deployed_contract_address             # Smart contract address on Sepolia
ADMIN_USERNAME=admin                                        # Admin login username
ADMIN_PASSWORD=your_secure_password                         # Admin login password
JWT_SECRET=your_random_secret_string                        # Secret for JWT token signing
```

On startup, the server validates that all required variables are present and exits with an error if any are missing.

---

## Server Initialization (What Happens on Startup)

When you run `node server.js`, the following happens in order:

### 1. Environment Validation (Lines 20–39)
```javascript
const requiredEnvVars = ['PORT', 'CONTRACT_ADDRESS', 'RPC_URL', 'PRIVATE_KEY', ...];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    process.exit(1);
}
```

### 2. Express App Configuration (Lines 45–92)
- **Helmet** security headers
- **CORS** configured to allow requests from `FRONTEND_URL`
- **Body parsing** with 10MB limit
- **Rate limiting**: 100 requests per 15 minutes per IP
- **Auth rate limiting**: 5 login attempts per 15 minutes
- **Request logging** with timestamps

### 3. SQLite Database Setup (Lines 98–120)
Creates the `certificates` table if it doesn't exist:

```sql
CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certId TEXT UNIQUE NOT NULL,          -- e.g., "CERT1708901234567"
    studentName TEXT NOT NULL,
    course TEXT NOT NULL,
    grade TEXT NOT NULL,
    issueDate TEXT NOT NULL,
    txHash TEXT,                          -- Blockchain transaction hash
    documentPath TEXT,                    -- Path to uploaded file
    documentOriginalName TEXT,            -- Original filename
    notes TEXT,                           -- Admin notes
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_certId ON certificates(certId);
```

### 4. Multer File Upload Setup (Lines 126–150)
- Files stored in `backend/uploads/` directory
- Max file size: 10MB
- Allowed types: PDF, PNG, JPEG only
- Temp filename: `temp_<timestamp>.<ext>` (renamed to `<certId>.<ext>` after issuance)

### 5. Blockchain Connection Setup (Lines 156–181)
```javascript
// Connect to Ethereum Sepolia via Alchemy RPC
const provider = new ethers.JsonRpcProvider(fetchReq, {
    name: 'sepolia',
    chainId: 11155111
}, { staticNetwork: true });

// Create wallet from private key
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Create contract instance with ABI
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
```

**Contract ABI (the 3 functions the backend calls):**
```javascript
const CONTRACT_ABI = [
    "function issueCertificate(string certId, string studentName, string course, string grade) external",
    "function verifyCertificate(string certId) external view returns (string, string, string, uint256, bool)",
    "function revokeCertificate(string certId) external"
];
```

### 6. Asset Preloading (Lines 187–207)
Loads university logo images (`logo1.jpg`, `logo2.jpg`) from the `assets/` directory into memory for fast PDF generation.

---

## API Endpoints

### Health Check Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Basic server health check (uptime, status) |
| `GET` | `/ready` | No | Detailed check (database + blockchain connection) |

---

### Authentication Endpoints

#### `POST /api/auth/login`

**Purpose:** Admin login to get a JWT token.

**Rate Limited:** 5 attempts per 15 minutes.

**Request Body:**
```json
{
    "username": "admin",
    "password": "your_password"
}
```

**Success Response:**
```json
{
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "username": "admin", "role": "admin" }
}
```

**How it works:**
1. Validates input (username required, password required)
2. Compares against `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`
3. If match, generates a JWT token with 24-hour expiration
4. If no match, returns 401 error

#### `GET /api/auth/verify`

**Purpose:** Verify that a JWT token is still valid.

**Headers:** `Authorization: Bearer <token>`

**Response:** `{ "valid": true, "user": { ... } }`

---

### Public Certificate Endpoints

#### `POST /api/certificates/issue`

**Purpose:** Issue a new certificate on the blockchain.

**Content-Type:** `multipart/form-data` (supports file upload)

**Request Fields:**
| Field | Type | Required | Validation |
|---|---|---|---|
| `studentName` | String | Yes | 2–100 characters |
| `course` | String | Yes | 2–100 characters |
| `grade` | String | Yes | 1–50 characters |
| `document` | File | No | PDF/PNG/JPEG, max 10MB |

**How it works step-by-step:**

1. **Generate Certificate ID:** `certId = "CERT" + Date.now()` → e.g., `CERT1708901234567`
2. **Issue on Blockchain:**
   ```javascript
   const tx = await contract.issueCertificate(certId, studentName, course, grade);
   await tx.wait();  // Wait for blockchain confirmation
   ```
3. **Handle File Upload:** If a document was attached, rename from temp name to `<certId>.pdf`
4. **Generate QR Code:** Creates a QR code pointing to `http://localhost:3000/verify/<certId>`
5. **Save to Database:** Stores all data including the blockchain transaction hash (`txHash`)

**Success Response:**
```json
{
    "success": true,
    "certId": "CERT1708901234567",
    "txHash": "0xabc123...",
    "hasDocument": true,
    "qrCode": "data:image/png;base64,...",
    "verifyUrl": "http://localhost:3000/verify/CERT1708901234567",
    "message": "Certificate issued successfully"
}
```

---

#### `GET /api/certificates/verify/:certId`

**Purpose:** Verify a certificate directly on the blockchain.

**How it works:**
1. Calls `contract.verifyCertificate(certId)` on the blockchain
2. Also queries the local database for additional data (txHash, document info)
3. Generates a QR code for the certificate

**Success Response:**
```json
{
    "exists": true,
    "studentName": "John Doe",
    "course": "Computer Science",
    "grade": "First Class Honours (4.50)",
    "issueDate": 1708901234,
    "isRevoked": false,
    "hasDocument": true,
    "txHash": "0xabc123...",
    "qrCode": "data:image/png;base64,...",
    "verifyUrl": "http://localhost:3000/verify/CERT1708901234567"
}
```

**If certificate doesn't exist:** `{ "exists": false }`

---

#### `GET /api/certificates/:certId/pdf`

**Purpose:** Generate and download an award-style certificate PDF.

**How it works:**
1. Verifies the certificate on the blockchain (must exist and not be revoked)
2. Generates a beautiful A4 landscape PDF using `pdf-lib` containing:
   - Decorative gold/green double borders with corner ornaments
   - University logo watermark (randomly selects logo1 or logo2)
   - University name, "AWARD OF EXCELLENCE" title
   - Student name, course, grade, and issue date
   - Official seal graphic
   - QR code for verification
   - "BLOCKCHAIN SECURED" label with certificate ID
   - Transaction hash reference
   - Diagonal watermark with certificate ID

**Response:** Binary PDF file download

---

#### `GET /api/certificates/download/:certId`

**Purpose:** Download the originally uploaded document with blockchain verification stamps overlaid.

**How it works:**
1. Verifies the certificate on the blockchain
2. Retrieves the uploaded document from the `uploads/` folder
3. If the document is a PDF:
   - Adds a blue "VERIFIED: CERT..." stamp bar at the bottom of every page
   - Adds a QR code to the bottom-right corner of every page
   - Adds a diagonal watermark with the certificate ID
4. If not a PDF, serves the file as-is

---

#### `GET /api/certificates/:certId/qrcode`

**Purpose:** Get just the QR code for a certificate.

**Response:** `{ "qrCode": "data:image/png;base64,...", "verifyUrl": "..." }`

---

### Admin-Only Endpoints

All admin endpoints require the `Authorization: Bearer <token>` header.

#### `GET /api/admin/certificates`

**Purpose:** Get all certificates with blockchain data.

**How it works:**
1. Queries all certificates from the SQLite database (ordered by newest first)
2. For each certificate, queries the blockchain for current status
3. Returns enriched data combining database + blockchain information

**Response:** Array of certificate objects with `blockchainData` containing live blockchain status.

---

#### `GET /api/admin/stats`

**Purpose:** Get dashboard statistics.

**Response:**
```json
{
    "totalCertificates": 15,
    "validCertificates": 12,
    "revokedCertificates": 3,
    "documentsUploaded": 8
}
```

**Note:** This endpoint queries every certificate on the blockchain individually to count valid vs revoked, which can be slow with many certificates.

---

#### `PUT /api/admin/certificates/:certId`

**Purpose:** Update a certificate's metadata (notes, document).

**Supports:** Updating the `notes` field and/or replacing the attached document.

---

#### `POST /api/admin/certificates/:certId/revoke`

**Purpose:** Revoke a certificate on the blockchain.

**How it works:**
1. Verifies the certificate exists on the blockchain
2. Sends a `revokeCertificate(certId)` transaction to the smart contract
3. Waits for blockchain confirmation

**Response:** `{ "success": true, "message": "...", "txHash": "0x..." }`

**Error cases:**
- Certificate doesn't exist → 404
- Already revoked → 400

---

#### `DELETE /api/admin/certificates/:certId`

**Purpose:** Delete a certificate from the database AND revoke it on the blockchain.

**How it works:**
1. Finds the certificate in the database
2. Checks blockchain status — if the certificate is NOT already revoked, **auto-revokes it first**
3. Deletes the uploaded document file from disk (if any)
4. Deletes the database record

This ensures blockchain consistency — you can't have a valid blockchain certificate with no database record.

---

## Middleware

### 1. Validation Error Handler (Lines 625–638)
Processes `express-validator` results and returns structured error responses.

### 2. Authentication Middleware (Lines 640–656)
Extracts JWT from `Authorization: Bearer <token>` header, verifies it, and attaches user info to `req.user`.

### 3. Global Error Handler (Lines 658–680)
Catches all unhandled errors including:
- Multer file size/type errors
- Custom errors with status codes
- Generic 500 internal server errors

---

## PDF Generation (Lines 226–619)

The `generateCertificatePDF()` function creates elaborate award-style certificates:

### PDF Layout (A4 Landscape — 842 × 595 points)

```
┌──────────────────────────────────────────────┐
│  ◆ ═══════ GOLD BORDER ═══════ ◆            │
│  │  ──── GREEN INNER BORDER ────  │          │
│  │                                 │          │
│  │         [University Logo]       │          │
│  │     Veritas University Abuja    │          │
│  │    ──── gold line ────          │          │
│  │                                 │          │
│  │    AWARD OF EXCELLENCE          │          │
│  │                                 │          │
│  │    This is to certify that      │          │
│  │    STUDENT NAME                 │          │
│  │    ──── gold underline ────     │          │
│  │    has completed requirements   │          │
│  │    Course Name                  │          │
│  │    with a grade of Grade        │          │
│  │                                 │          │
│  │    Issued on Date               │          │
│  │    ─── Signature Line ───       │          │
│  │    Registrar, Veritas Univ.     │          │
│  │                                 │          │
│  │ [OFFICIAL]          [QR CODE]   │          │
│  │ [SEAL]              Scan to     │          │
│  │                     Verify      │          │
│  │ BLOCKCHAIN SECURED              │          │
│  │ Certificate No: CERT...         │          │
│  │ TX: 0xabc123...                 │          │
│  │                                 │          │
│  │     ▓ VERIFIED: CERT... ▓       │          │
│  ◆ ═══════════════════════════ ◆            │
└──────────────────────────────────────────────┘
```

### Fonts Used:
- **Times Roman Bold** — University name, title, student name, course
- **Times Roman Italic** — "This is to certify that"
- **Helvetica Bold** — Grade, seal text, stamps
- **Helvetica** — Dates, labels, metadata

### Colors:
- **Veritas Green:** `rgb(0.04, 0.29, 0.20)` — University brand color
- **Gold:** `rgb(0.72, 0.53, 0.04)` — Borders and accents
- **Dark Gray:** `rgb(0.2, 0.2, 0.2)` — Body text

---

## Database Schema

### `certificates` Table

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER (PK) | Auto-incrementing primary key |
| `certId` | TEXT (UNIQUE) | Certificate ID, e.g., `CERT1708901234567` |
| `studentName` | TEXT | Student's full name |
| `course` | TEXT | Department/course name |
| `grade` | TEXT | Grade, e.g., `"First Class Honours (4.50)"` |
| `issueDate` | TEXT | ISO date string |
| `txHash` | TEXT | Blockchain transaction hash |
| `documentPath` | TEXT | Filename in `uploads/` directory |
| `documentOriginalName` | TEXT | Original uploaded filename |
| `notes` | TEXT | Admin notes |
| `createdAt` | TEXT | Auto-generated timestamp |

**Index:** `idx_certId` on `certId` for fast lookups.

---

## Security Measures

| Feature | Implementation |
|---|---|
| **HTTPS Headers** | Helmet.js sets security headers (CSP, X-Frame-Options, etc.) |
| **CORS** | Only allows requests from the configured frontend URL |
| **Rate Limiting** | 100 req/15min general, 5 req/15min for login |
| **Input Validation** | express-validator checks all user inputs |
| **JWT Authentication** | 24-hour tokens for admin access |
| **File Type Validation** | Only PDF, PNG, JPEG uploads allowed |
| **File Size Limit** | 10MB maximum upload size |
| **Graceful Shutdown** | Properly closes database on SIGTERM/SIGINT |

---

## Dual Storage Architecture

The system uses **both blockchain and database storage** for different purposes:

```
Blockchain (Ethereum Sepolia)                    SQLite Database
├── Source of TRUTH for:                         ├── Stores:
│   ├── Certificate existence                    │   ├── Certificate metadata (same as blockchain)
│   ├── Student name, course, grade              │   ├── Transaction hashes
│   ├── Issue date (block.timestamp)             │   ├── Uploaded document paths
│   └── Revocation status                        │   ├── Admin notes
│                                                │   └── Timestamps
├── Properties:                                  ├── Properties:
│   ├── Immutable (can't be changed)             │   ├── Mutable (can be updated/deleted)
│   ├── Public (anyone can read)                 │   ├── Private (only server can access)
│   ├── Slow (blockchain confirmation)           │   ├── Fast (local file)
│   └── Costs gas (real ETH for mainnet)         │   └── Free (no transaction cost)
```

**Why both?**
- The blockchain provides **tamper-proof verification** — nobody can fake a certificate
- The database provides **fast queries, file storage, and admin features** that the blockchain can't handle efficiently

---

## How to Run

```bash
cd backend
npm install       # Install dependencies
node server.js    # Start the server on port 5000
```

**Expected startup output:**
```
✅ Environment variables validated
Database initialized at: .../backend/certificates.db
✅ Asset preloading system initialized
==================================================
🚀 Certificate Verification Server Started
==================================================
📡 Server: http://localhost:5000
🌐 Frontend: http://localhost:3000
⛓️  Blockchain: https://eth-sepolia.g.alchemy.com/v2/...
📜 Contract: 0x...
💾 Database: .../backend/certificates.db
==================================================
```
