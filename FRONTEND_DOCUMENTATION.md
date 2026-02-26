# Frontend Documentation — Veritas Secure

## Overview

The frontend is a **React.js Single-Page Application (SPA)** that provides the user interface for the Blockchain Certificate Verification System. It communicates with the backend API to issue, verify, and manage academic certificates. The frontend runs on **http://localhost:3000**.

---

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| **React.js** | v19 | Component-based UI library |
| **React Router DOM** | v7 | Client-side routing & navigation |
| **Axios** | - | HTTP client for API requests |
| **CSS3** | - | Custom styling with glassmorphism effects |

---

## Project Structure

```
frontend/
├── public/                    # Static files (index.html, favicon, etc.)
├── src/
│   ├── App.js                 # Main application file (all components)
│   ├── App.css                # All styles (41,000+ bytes)
│   ├── App.test.js            # Test file
│   ├── index.js               # React entry point
│   ├── index.css              # Global base styles
│   ├── components/            # Reusable UI components
│   ├── utils/                 # Utility functions
│   ├── reportWebVitals.js     # Performance monitoring
│   └── setupTests.js          # Test configuration
├── package.json               # Dependencies & scripts
└── .env                       # Environment variables
```

---

## Environment Configuration

The frontend uses a `.env` file for configuration:

```env
REACT_APP_API_URL=http://localhost:5000/api
```

This value is accessed in the code as:
```javascript
const API_URL = process.env.REACT_APP_API_URL;
```

> **Note:** All React environment variables must be prefixed with `REACT_APP_` to be accessible in the browser.

---

## Application Architecture

The entire application is defined in a single file: `App.js` (1,011 lines). It contains **6 main components** organized by feature:

```
App (Root)
├── Router (BrowserRouter)
│   ├── Route "/" → MainApp
│   │   ├── IssueForm       → "Issue Certificate" tab
│   │   ├── VerifyForm       → "Verify Certificate" tab
│   │   └── AdminDashboard   → "Admin" tab
│   └── Route "/verify/:certId" → PublicVerifyPage
├── PremiumError             → Reusable error display
└── LegalModal               → Privacy, Terms, Contact modals
```

---

## Component Breakdown

### 1. `App` Component (Lines 1000–1009)

This is the **root component** that wraps everything in a `BrowserRouter` and defines two routes:

| Route | Component | Purpose |
|---|---|---|
| `/` | `MainApp` | Home page with tab navigation |
| `/verify/:certId` | `PublicVerifyPage` | Direct certificate verification via URL |

```javascript
function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<MainApp />} />
                <Route path="/verify/:certId" element={<PublicVerifyPage />} />
            </Routes>
        </Router>
    );
}
```

---

### 2. `MainApp` Component (Lines 852–994)

This is the **main page** that users see when they visit the website. It contains:

- **Hero Section** — A branded header with the title "Veritas Secure" and a tagline
- **Tab Navigation** — Three tabs: Issue Certificate, Verify Certificate, Admin
- **Content Area** — Renders the active tab's component
- **How It Works** — A 3-step visual guide (Issue → Secure → Verify)
- **Footer** — Copyright notice with links to Privacy Policy, Terms of Service, and Contact Support
- **Legal Modals** — Pop-up modals for Privacy Policy, Terms of Service, and Contact info

**State Management:**
```javascript
const [activeTab, setActiveTab] = useState('issue');    // Current active tab
const [activeModal, setActiveModal] = useState(null);    // Which legal modal is open
```

**Tab Switching Logic:**
```javascript
{activeTab === 'issue' && <IssueForm />}
{activeTab === 'verify' && <VerifyForm />}
{activeTab === 'admin' && <AdminDashboard />}
```

---

### 3. `IssueForm` Component (Lines 256–420)

**Purpose:** Allows institutions to issue new blockchain-secured certificates.

**State Variables:**
```javascript
const [studentName, setStudentName] = useState('');     // Student's full name
const [course, setCourse] = useState('');                // Department/course name
const [grade, setGrade] = useState('');                  // CGPA score (0.00 - 5.00)
const [document, setDocument] = useState(null);          // Optional PDF attachment
const [issueResult, setIssueResult] = useState(null);    // API response (success/error)
const [issueLoading, setIssueLoading] = useState(false); // Loading state
```

**Grade Classification System:**
The component includes a helper function `getDegreeClassInfo(cgpa)` that converts CGPA scores into Nigerian university degree classifications:

| CGPA Range | Classification |
|---|---|
| 4.50 – 5.00 | 🏆 First Class Honours |
| 3.50 – 4.49 | 🥈 Second Class Honours (Upper Division) |
| 2.40 – 3.49 | 🥉 Second Class Honours (Lower Division) |
| 1.50 – 2.39 | 📜 Third Class Honours |
| 1.00 – 1.49 | ✅ Pass |
| Below 1.00 | ❌ Fail |

**How Certificate Issuance Works:**

1. User fills in the form (student name, department, CGPA, optional PDF)
2. Data is packaged into a `FormData` object
3. Grade is formatted as: `"First Class Honours (4.50)"`
4. POST request is sent to `{API_URL}/certificates/issue`
5. On success, the response includes:
   - `certId` — Unique certificate ID (e.g., `CERT1708901234567`)
   - `txHash` — Blockchain transaction hash
   - `qrCode` — QR code image (base64)
   - `verifyUrl` — Direct verification link
6. User can copy the verification link or navigate to it

```javascript
const handleIssue = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('studentName', studentName);
    formData.append('course', course);
    formData.append('grade', formattedGrade);
    if (document) formData.append('document', document);

    const response = await axios.post(`${API_URL}/certificates/issue`, formData);
    setIssueResult(response.data);
};
```

---

### 4. `VerifyForm` Component (Lines 426–566)

**Purpose:** Allows anyone to verify a certificate by entering its ID.

**State Variables:**
```javascript
const [certId, setCertId] = useState('');                     // Certificate ID input
const [verifyResult, setVerifyResult] = useState(null);       // Verification result
const [verifyLoading, setVerifyLoading] = useState(false);    // Loading state
const [downloadLoading, setDownloadLoading] = useState({...}); // Download states
```

**How Verification Works:**

1. User enters a certificate ID (e.g., `CERT1708901234567`)
2. GET request to `{API_URL}/certificates/verify/{certId}`
3. Backend queries the **blockchain** directly for authenticity
4. Response shows one of four states:
   - ✅ **Valid** — Certificate exists and is active (shows details, QR code, download options)
   - 🔍 **Not Found** — Certificate doesn't exist on the blockchain
   - 🚫 **Revoked** — Certificate was revoked by admin
   - ❌ **Error** — Network/timeout error

**Download Features:**
- **Download Certificate PDF** — Generates an award-style PDF with decorative borders, QR code, and university branding
- **Download Stamped Document** — Downloads the original attached PDF with blockchain verification stamps overlaid

```javascript
const handleDownloadPDF = async () => {
    const response = await axios.get(`${API_URL}/certificates/${certId}/pdf`, {
        responseType: 'blob'  // Important: download as binary
    });
    // Creates a temporary download link and clicks it
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${certId}_certificate.pdf`);
    link.click();
};
```

---

### 5. `PublicVerifyPage` Component (Lines 70–246)

**Purpose:** A standalone verification page accessible via direct URL (`/verify/CERT123...`) or QR code scan.

**How it works:**
- Automatically extracts `certId` from the URL using `useParams()`
- Immediately calls the verification API on page load via `useEffect`
- Displays the same verification result as the VerifyForm component
- Includes a "Back to Home" link

This is the page that QR codes on certificates link to. When someone scans a QR code on a printed certificate, they land here and see the verification result instantly.

---

### 6. `AdminDashboard` Component (Lines 572–846)

**Purpose:** Protected admin panel for managing all certificates.

**State Variables:**
```javascript
const [isAdmin, setIsAdmin] = useState(false);              // Login status
const [adminToken, setAdminToken] = useState(                // JWT token
    localStorage.getItem('adminToken')
);
const [certificates, setCertificates] = useState([]);        // All certificates
const [stats, setStats] = useState(null);                    // Dashboard statistics
const [searchQuery, setSearchQuery] = useState('');           // Search filter
const [actionLoading, setActionLoading] = useState({});       // Per-certificate loading
```

**Authentication Flow:**

1. Checks `localStorage` for an existing JWT token on mount
2. If token exists, verifies it via `GET /api/auth/verify`
3. If no token, shows login form
4. Login sends `POST /api/auth/login` with username/password
5. On success, stores JWT token in `localStorage`
6. Token is included in all admin API requests as `Authorization: Bearer {token}`

**Dashboard Features:**

| Feature | Description |
|---|---|
| **Statistics Cards** | Shows total, valid, revoked certificates, and uploaded documents |
| **Search Bar** | Real-time filtering by student name, course, grade, or certificate ID |
| **Certificates Table** | Lists all certificates with columns: ID, Student, Course, Grade, Status, Actions |
| **View Action** (👁️) | Opens the public verification page for a certificate |
| **Revoke Action** (🚫) | Revokes a certificate on the blockchain (requires confirmation) |
| **Delete Action** (🗑️) | Deletes certificate from database + auto-revokes on blockchain |

**Search Implementation (Optimized with `useMemo`):**
```javascript
const filteredCertificates = React.useMemo(() => {
    if (!searchQuery) return certificates;
    const query = searchQuery.toLowerCase();
    return certificates.filter(cert => {
        const studentName = (cert.blockchainData?.studentName || '').toLowerCase();
        const course = (cert.blockchainData?.course || '').toLowerCase();
        // ... matches against all fields
        return studentName.includes(query) || course.includes(query) || ...;
    });
}, [certificates, searchQuery]);
```

---

### 7. `PremiumError` Component (Lines 12–41)

**Purpose:** Reusable error display component with different visual styles.

**Error Types:**

| Type | Icon | Color | Use Case |
|---|---|---|---|
| `error` | ❌ | Red | General errors |
| `notFound` | 🔍 | Orange | Certificate not found |
| `revoked` | 🚫 | Red-orange | Certificate was revoked |
| `timeout` | ⏱️ | Pink | Blockchain timeout |
| `network` | 🌐 | Red | Connection errors |

---

### 8. `LegalModal` Component (Lines 47–64)

**Purpose:** Reusable modal dialog for displaying legal content (Privacy Policy, Terms of Service, Contact Support).

- Closes when clicking the overlay background or the close button
- Uses `e.stopPropagation()` to prevent closing when clicking modal content

---

## API Communication

All API calls are made using **Axios**. The base URL is set from the environment variable:

```javascript
const API_URL = process.env.REACT_APP_API_URL; // e.g. "http://localhost:5000/api"
```

### API Endpoints Used by Frontend

| Method | Endpoint | Component | Purpose |
|---|---|---|---|
| `POST` | `/certificates/issue` | IssueForm | Issue a new certificate |
| `GET` | `/certificates/verify/:certId` | VerifyForm, PublicVerifyPage | Verify a certificate |
| `GET` | `/certificates/:certId/pdf` | VerifyForm, PublicVerifyPage | Download certificate PDF |
| `GET` | `/certificates/download/:certId` | VerifyForm, PublicVerifyPage | Download stamped document |
| `POST` | `/auth/login` | AdminDashboard | Admin login |
| `GET` | `/auth/verify` | AdminDashboard | Verify JWT token |
| `GET` | `/admin/certificates` | AdminDashboard | Get all certificates |
| `GET` | `/admin/stats` | AdminDashboard | Get dashboard statistics |
| `POST` | `/admin/certificates/:certId/revoke` | AdminDashboard | Revoke a certificate |
| `DELETE` | `/admin/certificates/:certId` | AdminDashboard | Delete a certificate |

---

## Routing

The app uses **React Router DOM v7** for client-side routing:

| Path | Component | Access |
|---|---|---|
| `/` | `MainApp` | Public — main page with tabs |
| `/verify/:certId` | `PublicVerifyPage` | Public — direct verification via URL/QR |

---

## Styling

All styles are in `App.css` (41,000+ bytes). Key design features:

- **Glassmorphism** — Frosted glass effects with `backdrop-filter: blur()`
- **Gradient Text** — The "Secure" text uses a CSS gradient
- **Smooth Animations** — Loading spinners, hover effects, transitions
- **Responsive Design** — Works on desktop, tablet, and mobile
- **Dark/Premium Color Palette** — Deep greens, golds, and dark backgrounds
- **Veritas University Branding** — Green and gold color scheme

---

## Data Flow Diagram

```
User Action → React Component → Axios HTTP Request → Backend API → Blockchain/Database
                                                          ↓
User Sees ← React Re-renders ← State Update ←── JSON Response
```

**Example flow for verifying a certificate:**

1. User enters `CERT1708901234567` in the VerifyForm
2. `handleVerify()` is called
3. Axios sends `GET http://localhost:5000/api/certificates/verify/CERT1708901234567`
4. Backend queries the blockchain smart contract
5. Backend returns JSON with student name, course, grade, issue date, revocation status
6. React updates `verifyResult` state
7. Component re-renders to show the verification result

---

## How to Run

```bash
cd frontend
npm install       # Install dependencies
npm start         # Start development server on port 3000
```

The frontend will automatically open at **http://localhost:3000** and proxy API calls to the backend at **http://localhost:5000**.
