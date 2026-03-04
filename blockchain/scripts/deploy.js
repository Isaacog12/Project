const { ethers, network, upgrades } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    console.log("Starting deployment...");

    const networkName = network.name || 'localhost';
    const backendEnvPath = path.join(__dirname, '../../backend/.env');

    // Get RPC URL for the current network
    let rpcUrl = "http://127.0.0.1:8545";
    if (network === 'sepolia') {
        rpcUrl = process.env.SEPOLIA_RPC_URL || "";
    }

    console.log(`Deploying to network: ${networkName}`);
    console.log(`Using RPC URL: ${rpcUrl}`);

    // Get the smart contract factory
    const CertificateRegistry = await ethers.getContractFactory("CertificateRegistry");

    console.log("Deploying CertificateRegistry Proxy...");
    const contract = await upgrades.deployProxy(CertificateRegistry, [], {
        initializer: "initialize",
        kind: "uups"
    });

    await contract.waitForDeployment();

    // contract.target is the address of the Proxy (the one we use to interact)
    const address = contract.target;

    console.log("✅ CertificateRegistry Proxy deployed to:", address);

    // Get the implementation address just for reference
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(address);
    console.log("🔍 Implementation contract deployed to:", implementationAddress);

    console.log("\nSaving configuration...");

    // 1. Save to contract-address.txt
    fs.writeFileSync(
        path.join(__dirname, '../contract-address.txt'),
        address
    );
    console.log("✅ Saved to contract-address.txt");

    // 2. Update Backend .env file
    try {
        if (fs.existsSync(backendEnvPath)) {
            let envContent = fs.readFileSync(backendEnvPath, 'utf8');

            // Update CONTRACT_ADDRESS
            if (envContent.includes('CONTRACT_ADDRESS=')) {
                envContent = envContent.replace(/CONTRACT_ADDRESS=.*/, `CONTRACT_ADDRESS=${address}`);
            } else {
                envContent += `\nCONTRACT_ADDRESS=${address}`;
            }

            // Update RPC_URL
            if (envContent.includes('RPC_URL=')) {
                envContent = envContent.replace(/RPC_URL=.*/, `RPC_URL=${rpcUrl}`);
            } else {
                envContent += `\nRPC_URL=${rpcUrl}`;
            }

            fs.writeFileSync(backendEnvPath, envContent);
            console.log("✅ Updated backend/.env file with proxy address and RPC URL");
        } else {
            console.warn(`⚠️ Warning: backend/.env not found at ${backendEnvPath}`);
            console.log("You will need to manually set:");
            console.log(`CONTRACT_ADDRESS=${address}`);
            console.log(`RPC_URL=${rpcUrl}`);
        }
    } catch (error) {
        console.error("❌ Failed to update backend/.env:", error.message);
    }

    // 3. Save a detailed configuration file
    const configData = {
        network: networkName,
        proxyAddress: address,
        implementationAddress,
        rpcUrl,
        deployedAt: new Date().toISOString()
    };

    fs.writeFileSync(
        path.join(__dirname, '../deployment-config.json'),
        JSON.stringify(configData, null, 2)
    );
    console.log("✅ Saved deployment-config.json");

    console.log("\n🎉 Deployment complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:");
        console.error(error);
        process.exit(1);
    });