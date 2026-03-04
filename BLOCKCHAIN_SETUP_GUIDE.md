# Blockchain Setup and Linking Guide (Tailored)

This document provides a step-by-step guide to setting up the local blockchain environment for the **SecureCert** project and linking it to the backend. It's tailored exactly to how your current system is connected using Hardhat, OpenZeppelin UUPS proxies, and your specific `.env` setup.

---

## 1. How Your Blockchain is Connected

Your system deploys a **CertificateRegistry Proxy** using the OpenZeppelin Upgrades plugin (UUPS pattern). This means the address your backend interacts with is the *Proxy* address, which allows for future smart contract upgrades without changing the contract address.

Your primary development environment is currently running on the **localhost Hardhat Network** (`http://127.0.0.1:8545`), which requires you to start a local node before deploying.

---

## 2. Setup Prerequisites

1.  **Node.js**: Ensure you have Node installed (v14+ recommended).
2.  **Hardhat**: Used for your local Ethereum node and deployment scripts.
3.  **Terminal Setup**: You will need **two separate terminals** running concurrently for the blockchain to work with your backend.

---

## 3. Step-by-Step Local Deployment

### Step A: Start the Local Blockchain Node
Open your first terminal window and navigate to the blockchain directory:
```bash
cd blockchain
npx hardhat node
```
*Leave this terminal running. It simulates an Ethereum blockchain on your machine (running at `http://127.0.0.1:8545`). It also provides you with 20 test accounts and private keys.*

### Step B: Compile and Deploy the Smart Contract
Open a **second terminal window**, navigate to the blockchain directory, and run your deployment script against the local network:
```bash
cd blockchain
npx hardhat run scripts/deploy.js --network localhost
```

**What happens during deployment:**
1.  Hardhat compiles the `CertificateRegistry` contract.
2.  It deploys the **UUPS Proxy** and the **Implementation Contract**.
3.  The script outputs the Proxy address (e.g., `0xe7f1725E...`).
4.  **Automatic Linking**: The `deploy.js` script actively edits your `backend/.env` file and updates the `CONTRACT_ADDRESS` and `RPC_URL` lines automatically. It also writes the proxy address to `contract-address.txt` and saves details in `deployment-config.json`.

---

## 4. Verifying the Backend Link

Your backend is already thoroughly coded to connect to this setup using `ethers.js`. To ensure the deployment script successfully linked the blockchain, check your `backend/.env` file. It should look like this:

```env
# backend/.env
PORT=5000
CONTRACT_ADDRESS=0xYourNewProxyAddressHere
RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY=863a8938379ae06c0f06ad686663097c35b44cd3b56ffa698ab5bb898f601899

# ... (other admin and frontend variables)
```
*Note: The `PRIVATE_KEY` above belongs to one of the default Hardhat test accounts. This account acts as the authorized deployer and issuer.*

---

## 5. Running the Full Application

Now that the blockchain is running and the proxy address is linked in the backend:

1.  Keep **Terminal 1** (`npx hardhat node`) running.
2.  In **Terminal 2**, go to the backend and start the server:
    ```bash
    cd ../backend
    npm start
    ```
    *You should see "Environment variables validated" and "ready" status.*
3.  In a **third terminal**, run the frontend:
    ```bash
    cd ../frontend
    npm start
    ```

You are now fully synced! The frontend sends requests to the backend, which in turn signs transactions using the `PRIVATE_KEY` and sends them via the `RPC_URL` (`127.0.0.1:8545`) to your local Hardhat node, utilizing the `CONTRACT_ADDRESS` (the Upgradable Proxy) to issue or verify certificates.

---

## 6. (Optional) Deploying to Sepolia Testnet

If you decide to move away from `localhost` and deploy to the live testnet in the future:

1.  In `blockchain/.env`, ensure you have your real Alchemy API key and real MetaMask private key:
    ```env
    SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
    ```
2.  Run the deployment pointing to Sepolia:
    ```bash
    cd blockchain
    npx hardhat run scripts/deploy.js --network sepolia
    ```
3.  *The backend `.env` will automatically be updated with the Alchemy RPC URL and the new Sepolia contract address by the deployment script.* Just remember to update the backend's `PRIVATE_KEY` to your MetaMask account's private key so it has permission to issue certificates.
