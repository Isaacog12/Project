# Blockchain Documentation — Veritas Secure

## Overview

The blockchain layer is the **trust foundation** of the entire system. It uses an **Ethereum smart contract** written in Solidity, deployed on the **Sepolia test network**, to provide tamper-proof, immutable storage of certificate data. Even if the database or server is compromised, the blockchain record can independently verify any certificate's authenticity.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| **Solidity** (v0.8.20) | Smart contract programming language |
| **Hardhat** | Ethereum development environment (compile, test, deploy) |
| **OpenZeppelin** | Standardized, audited smart contract libraries |
| **TypeScript** | Type-safe development for tests and scripts |
| **TypeChain** | Auto-generates TypeScript types for contracts |
| **Chai** | Assertion library for contract testing |
| **Ethers.js** | Blockchain interaction (used by backend & deploy script) |

---

## Project Structure

```
blockchain/
├── contracts/
│   └── CertificateRegistry.sol     # The smart contract (79 lines)
├── scripts/
│   └── deploy.js                    # Deployment script (69 lines)
├── test/
│   └── (test files)                 # Contract tests
├── artifacts/                       # Compiled contract ABIs (auto-generated)
├── cache/                           # Hardhat compilation cache
├── hardhat.config.js                # Hardhat configuration
├── contract-address.txt             # Deployed contract address
├── deployment-config.json           # Deployment metadata
├── .env                             # Environment variables
├── .env.example                     # Template
└── package.json                     # Dependencies
```

---

## Environment Variables

```env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
DEPLOYER_PRIVATE_KEY=your_metamask_wallet_private_key
```

---

## The Smart Contract: `CertificateRegistry.sol`

This is the core of the blockchain layer — a single Solidity contract that stores and manages certificates.

### Full Contract Code (79 lines)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CertificateRegistry {
    struct Certificate {
        string studentName;
        string course;
        string grade;
        uint256 issueDate;
        bool isRevoked;
        bool exists;
    }

    mapping(string => Certificate) public certificates;
    mapping(address => bool) public authorizedInstitutions;
    address public admin;

    event CertificateIssued(string certId, string studentName);
    event CertificateRevoked(string certId);

    constructor() {
        admin = msg.sender;
        authorizedInstitutions[msg.sender] = true;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyAuthorized() {
        require(authorizedInstitutions[msg.sender], "Not authorized");
        _;
    }

    function addInstitution(address institution) external onlyAdmin { ... }
    function issueCertificate(string certId, ...) external onlyAuthorized { ... }
    function revokeCertificate(string certId) external onlyAuthorized { ... }
    function verifyCertificate(string certId) external view returns (...) { ... }
}
```

---

### Data Structures

#### `Certificate` Struct
Each certificate stored on the blockchain contains:

| Field | Type | Description |
|---|---|---|
| `studentName` | `string` | Full name of the student |
| `course` | `string` | Department or course name |
| `grade` | `string` | Grade/CGPA classification |
| `issueDate` | `uint256` | Unix timestamp (set by `block.timestamp`) |
| `isRevoked` | `bool` | Whether the certificate has been revoked |
| `exists` | `bool` | Whether this certificate ID has been used |

#### Storage Mappings

```solidity
mapping(string => Certificate) public certificates;
// Key: certId (e.g., "CERT1708901234567") → Value: Certificate struct

mapping(address => bool) public authorizedInstitutions;
// Key: wallet address → Value: whether authorized to issue/revoke
```

#### State Variables

```solidity
address public admin;
// The wallet address that deployed the contract — has full admin rights
```

---

### Access Control

The contract uses two levels of access control:

#### `onlyAdmin` Modifier
Only the wallet that deployed the contract can call functions with this modifier.

```solidity
modifier onlyAdmin() {
    require(msg.sender == admin, "Only admin");
    _;
}
```

**Used by:** `addInstitution()`

#### `onlyAuthorized` Modifier
Only wallets that have been explicitly authorized can call functions with this modifier. The deployer is automatically authorized.

```solidity
modifier onlyAuthorized() {
    require(authorizedInstitutions[msg.sender], "Not authorized");
    _;
}
```

**Used by:** `issueCertificate()`, `revokeCertificate()`

---

### Contract Functions

#### 1. `constructor()`

**Called:** Once, when the contract is deployed.

**What it does:**
- Sets the deployer's wallet address as `admin`
- Automatically authorizes the deployer to issue/revoke certificates

```solidity
constructor() {
    admin = msg.sender;
    authorizedInstitutions[msg.sender] = true;
}
```

---

#### 2. `addInstitution(address institution)`

**Access:** Admin only

**Purpose:** Authorize a new wallet address to issue and revoke certificates. This allows multiple institutions to use the same contract.

```solidity
function addInstitution(address institution) external onlyAdmin {
    authorizedInstitutions[institution] = true;
}
```

> **Note:** This function is available but not currently used by the backend. The system currently operates with a single authorized wallet.

---

#### 3. `issueCertificate(string certId, string studentName, string course, string grade)`

**Access:** Authorized institutions only

**Purpose:** Create a new certificate record on the blockchain.

**Checks:**
- The `certId` must not already exist (prevents duplicate certificates)

**What it does:**
1. Verifies the certId hasn't been used
2. Creates a new `Certificate` struct with all provided data
3. Sets `issueDate` to the current block timestamp (`block.timestamp`)
4. Sets `isRevoked` to `false` and `exists` to `true`
5. Emits a `CertificateIssued` event

```solidity
function issueCertificate(
    string memory certId,
    string memory studentName,
    string memory course,
    string memory grade
) external onlyAuthorized {
    require(!certificates[certId].exists, "Already exists");

    certificates[certId] = Certificate({
        studentName: studentName,
        course: course,
        grade: grade,
        issueDate: block.timestamp,
        isRevoked: false,
        exists: true
    });

    emit CertificateIssued(certId, studentName);
}
```

**Gas Cost:** This is a **write operation** — it modifies the blockchain state and requires gas (SepoliaETH on testnet, real ETH on mainnet).

---

#### 4. `revokeCertificate(string certId)`

**Access:** Authorized institutions only

**Purpose:** Mark a certificate as revoked. The record stays on the blockchain forever, but its status changes.

**Checks:**
- Certificate must exist
- Certificate must not already be revoked

```solidity
function revokeCertificate(string memory certId) external onlyAuthorized {
    require(certificates[certId].exists, "Certificate does not exist");
    require(!certificates[certId].isRevoked, "Already revoked");

    certificates[certId].isRevoked = true;
    emit CertificateRevoked(certId);
}
```

**Important:** Revocation is **permanent and irreversible**. Once revoked, a certificate cannot be un-revoked. The original data (name, course, grade) remains on the blockchain permanently.

**Gas Cost:** Write operation — requires gas.

---

#### 5. `verifyCertificate(string certId)`

**Access:** Public — anyone can call this function (it's `view`, meaning it reads data without modifying the blockchain).

**Purpose:** Look up a certificate by its ID and return all stored data.

**Returns:**

| Return Value | Type | Description |
|---|---|---|
| `studentName` | `string` | Student's name |
| `course` | `string` | Course/department |
| `grade` | `string` | Grade classification |
| `issueDate` | `uint256` | Unix timestamp of issuance |
| `isRevoked` | `bool` | Whether the certificate was revoked |

```solidity
function verifyCertificate(string memory certId) external view returns (
    string memory studentName,
    string memory course,
    string memory grade,
    uint256 issueDate,
    bool isRevoked
) {
    require(certificates[certId].exists, "Certificate does not exist");
    Certificate memory cert = certificates[certId];
    return (cert.studentName, cert.course, cert.grade, cert.issueDate, cert.isRevoked);
}
```

**Gas Cost:** **FREE** — `view` functions don't cost gas because they only read data.

---

### Events

Events are logged on the blockchain and can be listened to by off-chain applications:

```solidity
event CertificateIssued(string certId, string studentName);
// Emitted when a new certificate is created

event CertificateRevoked(string certId);
// Emitted when a certificate is revoked
```

These events can be queried using blockchain explorers like Etherscan, or programmatically using Ethers.js event listeners.

---

## Network Configuration: `hardhat.config.js`

```javascript
module.exports = {
    solidity: "0.8.20",
    networks: {
        hardhat: {                          // Local in-memory blockchain for testing
            chainId: 1337,
            mining: { auto: true, interval: 0 }
        },
        localhost: {                        // Local Hardhat node (persistent)
            url: "http://127.0.0.1:8545",
            chainId: 1337
        },
        sepolia: {                          // Ethereum Sepolia testnet
            url: process.env.SEPOLIA_RPC_URL || "",
            accounts: process.env.DEPLOYER_PRIVATE_KEY
                ? [process.env.DEPLOYER_PRIVATE_KEY]
                : [],
            chainId: 11155111
        }
    },
    paths: {
        artifacts: "./artifacts",
        cache: "./cache",
        sources: "./contracts",
        tests: "./test"
    }
};
```

### Available Networks

| Network | Chain ID | URL | Use Case |
|---|---|---|---|
| `hardhat` | 1337 | In-memory | Unit testing |
| `localhost` | 1337 | `http://127.0.0.1:8545` | Local development |
| `sepolia` | 11155111 | Alchemy RPC URL | Testnet deployment |

---

## Deployment Script: `deploy.js`

### What it does:

1. **Compiles and deploys** the `CertificateRegistry` contract to the specified network
2. **Saves the contract address** to `contract-address.txt`
3. **Auto-updates the backend `.env` file** with the new contract address and RPC URL
4. **Saves deployment metadata** to `deployment-config.json`

### Step-by-step:

```javascript
async function main() {
    // 1. Get the contract factory (compiled bytecode)
    const Contract = await ethers.getContractFactory("CertificateRegistry");

    // 2. Deploy the contract (sends a transaction to the network)
    const contract = await Contract.deploy();
    await contract.waitForDeployment();

    // 3. Get the deployed address
    const address = await contract.getAddress();
    console.log("Contract deployed to:", address);

    // 4. Save address to contract-address.txt
    fs.writeFileSync('contract-address.txt', address);

    // 5. Auto-update backend/.env with CONTRACT_ADDRESS and RPC_URL
    let envContent = fs.readFileSync(backendEnvPath, 'utf8');
    envContent = envContent.replace(/CONTRACT_ADDRESS=.*/, `CONTRACT_ADDRESS=${address}`);
    envContent = envContent.replace(/RPC_URL=.*/, `RPC_URL=${rpcUrl}`);
    fs.writeFileSync(backendEnvPath, envContent);

    // 6. Save deployment config with metadata
    fs.writeFileSync('deployment-config.json', JSON.stringify({
        address, network, chainId, deployedAt, contractName
    }, null, 2));
}
```

### How to Deploy

**To Sepolia testnet:**
```bash
cd blockchain
npx hardhat run scripts/deploy.js --network sepolia
```

**To local Hardhat node (for development):**
```bash
# Terminal 1: Start local blockchain
npx hardhat node

# Terminal 2: Deploy
npx hardhat run scripts/deploy.js --network localhost
```

---

## How Backend Connects to the Contract

The backend uses **Ethers.js v6** to interact with the deployed smart contract:

```javascript
// 1. Create a provider (connection to the Ethereum network via Alchemy)
const provider = new ethers.JsonRpcProvider(
    fetchReq,                           // RPC URL with 120s timeout
    { name: 'sepolia', chainId: 11155111 },
    { staticNetwork: true }
);

// 2. Create a wallet (can sign transactions)
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// 3. Create a contract instance (ABI + address + signer)
const contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    CONTRACT_ABI,
    wallet
);

// 4. Call contract functions
await contract.issueCertificate(certId, name, course, grade);  // Write (costs gas)
await contract.verifyCertificate(certId);                       // Read (free)
await contract.revokeCertificate(certId);                       // Write (costs gas)
```

### Backend Contract ABI (Application Binary Interface)

The backend only needs to know the function signatures:

```javascript
const CONTRACT_ABI = [
    "function issueCertificate(string certId, string studentName, string course, string grade) external",
    "function verifyCertificate(string certId) external view returns (string, string, string, uint256, bool)",
    "function revokeCertificate(string certId) external"
];
```

---

## Gas Costs and Transaction Flow

### Write Transactions (issueCertificate, revokeCertificate)

```
Backend calls contract.issueCertificate(...)
    ↓
Ethers.js creates a transaction
    ↓
Transaction is signed with the wallet's private key
    ↓
Transaction is sent to Alchemy RPC → Sepolia network
    ↓
Miners/validators include the transaction in a block
    ↓
tx.wait() resolves when the block is confirmed
    ↓
Backend receives the transaction hash (txHash)
```

**Time:** ~15-30 seconds on Sepolia (depends on network congestion)
**Cost:** Gas fee paid in SepoliaETH (free on testnet; real cost on mainnet)

### Read Transactions (verifyCertificate)

```
Backend calls contract.verifyCertificate(...)
    ↓
Ethers.js sends a "call" (not a transaction)
    ↓
The RPC node executes the function locally
    ↓
Result is returned immediately
    ↓
No gas cost, no transaction hash
```

**Time:** ~1-3 seconds
**Cost:** Free

---

## Key Blockchain Concepts

### Immutability
Once data is written to the blockchain, it **cannot be modified or deleted**. Revoking a certificate doesn't remove it — it adds a new flag (`isRevoked = true`). The original data remains readable forever.

### Transparency
The smart contract and all its data are **publicly visible** on the blockchain. Anyone can verify certificates using Etherscan or any Ethereum client without needing our backend.

### Decentralization
Even if our server goes down, the certificate data persists on the Ethereum blockchain. Anyone with the contract address and ABI can verify certificates independently.

### Block Timestamp
The `issueDate` is set to `block.timestamp`, which is the time the block was mined. This timestamp is determined by the network validators, not by our application, making it a trustworthy and tamper-proof record of when the certificate was issued.

---

## Viewing the Contract on Etherscan

Once deployed, you can view the contract at:
```
https://sepolia.etherscan.io/address/<CONTRACT_ADDRESS>
```

This shows:
- All transactions (issuance, revocations)
- Contract source code (if verified)
- Event logs
- Contract storage

---

## How to Set Up from Scratch

### Prerequisites
- **Node.js** v14+
- **MetaMask** browser extension with a Sepolia wallet
- **SepoliaETH** from a faucet (for gas fees)
- **Alchemy** account (free) for the RPC URL

### Steps

```bash
# 1. Navigate to blockchain directory
cd blockchain

# 2. Install dependencies
npm install

# 3. Create .env file
echo "SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY" > .env
echo "DEPLOYER_PRIVATE_KEY=your_metamask_private_key" >> .env

# 4. Compile the contract
npx hardhat compile

# 5. Deploy to Sepolia
npx hardhat run scripts/deploy.js --network sepolia

# 6. Note the contract address from the output
# The deploy script auto-updates backend/.env with the address
```

### After Deployment
- The contract address is saved to `contract-address.txt`
- The backend `.env` is auto-updated with `CONTRACT_ADDRESS` and `RPC_URL`
- Deployment metadata is saved to `deployment-config.json`
- You can restart the backend server, and it will connect to the new contract

---

## Security Considerations

| Risk | Mitigation |
|---|---|
| **Private key exposure** | Key stored in `.env` file (never committed to git) |
| **Unauthorized issuance** | `onlyAuthorized` modifier restricts who can issue |
| **Duplicate certificates** | `require(!certificates[certId].exists)` prevents duplicates |
| **Re-revocation** | `require(!certificates[certId].isRevoked)` prevents re-revocation |
| **Reentrancy attacks** | No external calls or ETH transfers — not vulnerable |
| **Integer overflow** | Solidity 0.8.20 has built-in overflow checks |
