# Blockchain Certificate Verification System

A secure, blockchain-based certificate verification system for educational institutions in Nigeria, built with React, Node.js, and Ethereum smart contracts.

## 🎓 Features

- **Issue Certificates** - Create blockchain-secured academic certificates
- **Verify Certificates** - Instant verification with QR codes
- **Admin Dashboard** - Manage, search, and revoke certificates
- **PDF Generation** - Beautiful award-style certificates with decorative borders
- **Blockchain Security** - Tamper-proof storage on Ethereum Sepolia testnet
- **Premium UI** - Glassmorphism design with smooth animations

## 🚀 Tech Stack

### Frontend
- React.js
- Premium CSS with glassmorphism effects
- Responsive design with mobile optimization
- Accessibility (WCAG AA compliant)

### Backend
- Node.js + Express
- SQLite database
- PDF generation with pdf-lib
- QR code generation
- File upload handling

### Blockchain
- Ethereum (Sepolia Testnet)
- Hardhat development environment
- Ethers.js for blockchain interaction
- Smart contract for certificate management

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- MetaMask wallet (for blockchain transactions)
- Alchemy API key (for Ethereum RPC)

## 🛠️ Installation

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd Project
```

### 2. Install dependencies

**Frontend:**
```bash
cd frontend
npm install
```

**Backend:**
```bash
cd backend
npm install
```

**Blockchain:**
```bash
cd blockchain
npm install
```

### 3. Environment Setup

Create a `.env` file in the `backend` directory:

```env
PORT=5000
FRONTEND_URL=http://localhost:3000
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
PRIVATE_KEY=your_wallet_private_key
CONTRACT_ADDRESS=your_deployed_contract_address
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password
JWT_SECRET=your_jwt_secret
```

### 4. Deploy Smart Contract

```bash
cd blockchain
npx hardhat run scripts/deploy.js --network sepolia
```

Copy the deployed contract address to your `.env` file.

## 🏃 Running the Application

### Start Backend Server
```bash
cd backend
node server.js
```
Server runs on `http://localhost:5000`

### Start Frontend
```bash
cd frontend
npm start
```
Frontend runs on `http://localhost:3000`

## 📱 Usage

### Issue a Certificate
1. Navigate to "Issue Certificate" tab
2. Fill in student details (name, course, grade)
3. Upload supporting document (optional)
4. Click "Issue Certificate"
5. Wait for blockchain confirmation

### Verify a Certificate
1. Navigate to "Verify Certificate" tab
2. Enter certificate ID or scan QR code
3. View certificate details and blockchain verification

### Admin Dashboard
1. Navigate to "Admin" tab
2. Login with credentials
3. View statistics and all certificates
4. Search certificates by name, ID, course, or grade
5. Revoke or delete certificates as needed

## 🎨 Design Features

- **Decorative PDF Certificates** - Award-style design with gold/green borders
- **QR Code Integration** - Instant verification via smartphone
- **Search Functionality** - Real-time filtering in admin dashboard
- **Responsive Design** - Works on desktop, tablet, and mobile
- **Premium Animations** - Smooth transitions and glassmorphism effects
- **Veritas Branding** - University logo watermark background

## 🔒 Security

- Blockchain-based certificate storage (tamper-proof)
- JWT authentication for admin access
- Environment variable protection
- Input validation and sanitization
- CORS configuration

## 📄 License

This project is licensed under the MIT License.

## 👥 Contributors

- Your Name - Initial work

## 🙏 Acknowledgments

- Veritas University Abuja
- Ethereum Foundation
- Alchemy for RPC services
