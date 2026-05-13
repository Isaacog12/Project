# 🛡️ SecureCert: Blockchain Credentialing System

<div align="center">
  <h3>Immutable trust for academic excellence.</h3>
  <p><i>A decentralized platform for issuing, managing, and verifying academic credentials with cryptographic certainty.</i></p>
</div>

---

## 🌟 Introduction
**SecureCert** is a high-performance blockchain-based system designed to eliminate certificate forgery. It uses the Ethereum blockchain to store immutable records of certificates and IPFS for decentralized document storage.

This guide will help you set up the entire project on a fresh machine from scratch.

---

## 📋 Prerequisites
Before you begin, ensure you have the following installed:

1.  **Node.js (v18 or higher)**: [Download here](https://nodejs.org/)
2.  **Git**: [Download here](https://git-scm.com/)
3.  **MetaMask Browser Extension**: [Download here](https://metamask.io/)
4.  **A Code Editor**: Visual Studio Code is recommended.

---

## 🛠️ Step-by-Step Installation

### 1. Clone the Project
Open your terminal and run:
```bash
git clone <repository-url>
cd SecureCert
```

### 2. Install Dependencies
You need to install packages for all three parts of the system. Open three different terminals or run these one by one:

**Blockchain:**
```bash
cd blockchain
npm install
```

**Backend:**
```bash
cd ../backend
npm install
```

**Frontend:**
```bash
cd ../frontend
npm install
```

### 3. Configure IPFS (Optional but Recommended)
The system uses **Pinata** for IPFS storage.
1. Create a free account at [Pinata.cloud](https://www.pinata.cloud/).
2. Generate an API Key.
3. Open `backend/.env` and update the following values:
   ```env
   PINATA_API_KEY=your_key
   PINATA_SECRET_API_KEY=your_secret
   ```

---

## 🚀 Running the System (Execution Order)

To run the system correctly, you must follow this specific order. Use **4 separate terminal windows**.

### Step 1: Start the Local Blockchain
In Terminal 1:
```bash
cd blockchain
npx hardhat node
```
*Leave this running. You will see a list of accounts and private keys. **Save Account #0's private key for MetaMask later.***

### Step 2: Deploy the Smart Contract
In Terminal 2:
```bash
cd blockchain
npx hardhat run scripts/simple-deploy.js --network localhost
```
*This script will deploy the contract and automatically update the address in the backend and frontend configurations.*

### Step 3: Start the Backend Server
In Terminal 3:
```bash
cd backend
node server.js
```
*The server will start at `http://localhost:5000`. It handles PDF generation, IPFS pinning, and database caching.*

### Step 4: Launch the Frontend UI
In Terminal 4:
```bash
cd frontend
npm start
```
*The application will open in your browser at `http://localhost:3000`.*

---

## 🦊 MetaMask Configuration
To interact with the system as an admin, you must connect MetaMask to your local node:

1.  **Add Local Network**:
    *   Open MetaMask > Settings > Networks > Add Network.
    *   Network Name: `Hardhat Local`
    *   RPC URL: `http://127.0.0.1:8545`
    *   Chain ID: `1337`
    *   Currency Symbol: `ETH`
2.  **Import Account**:
    *   Copy the **Private Key** of **Account #0** from the `hardhat node` terminal (Terminal 1).
    *   In MetaMask, click "Import Account" and paste the key.
3.  **⚠️ Critical Step (Resetting Account)**:
    *   If you restart the `hardhat node`, you **MUST** reset your account in MetaMask to avoid "Nonce" errors.
    *   Go to MetaMask > Settings > Advanced > **Clear activity tab data** (or Reset Account).

---

## 📂 Project Structure
*   `/blockchain`: Solidity smart contracts and deployment scripts.
*   `/backend`: Express API, Prisma DB models, and PDF generation logic.
*   `/frontend`: React application with virtualized dashboards and premium UI.
*   `/uploads`: Local storage for cached certificates and temporary files.

---

## 🧪 Admin Credentials
To access the Admin Dashboard at `/admin`:
*   **Username**: `admin`
*   **Password**: `admin@2026`

---

## 👥 Contributors
- **TIFE** - Development & Architecture
- **Isaacog12** - Project Lead

---
<div align="center">
  <p><b>SecureCert © 2026</b></p>
</div>