const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with:", deployer.address);

    const CertificateRegistry = await ethers.getContractFactory("CertificateRegistry");
    const contract = await CertificateRegistry.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log("Contract deployed to:", address);

    // Auto-authorize the first 5 accounts for local development
    const accounts = await ethers.getSigners();
    const accountsToAuthorize = accounts.slice(0, 5);
    console.log(`Authorizing first ${accountsToAuthorize.length} accounts...`);
    
    for (const account of accountsToAuthorize) {
        if (account.address === deployer.address) continue; // Already authorized in constructor
        const tx = await contract.addInstitution(account.address);
        await tx.wait();
        console.log(`- Authorized: ${account.address}`);
    }

    fs.writeFileSync(path.join(__dirname, '../contract-address.txt'), address);
    
    // Update .env
    const envPath = path.join(__dirname, '../../backend/.env');
    if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/CONTRACT_ADDRESS=.*/, `CONTRACT_ADDRESS=${address}`);
        fs.writeFileSync(envPath, envContent);
        console.log("Updated backend/.env");
    }
}

main().catch(console.error);
