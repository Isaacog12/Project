async function main() {
    console.log("Deploying CertificateRegistry contract...");

    const Contract = await ethers.getContractFactory("CertificateRegistry");
    const contract = await Contract.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log("Contract deployed to:", address);

    // Save address to multiple locations
    const fs = require('fs');
    const path = require('path');

    // Save to blockchain directory
    fs.writeFileSync('contract-address.txt', address);
    console.log("Address saved to contract-address.txt");

    // Detect network
    const network = await ethers.provider.getNetwork();
    const networkName = network.chainId === 11155111n ? 'sepolia' : 'localhost';
    const rpcUrl = networkName === 'sepolia'
        ? process.env.SEPOLIA_RPC_URL
        : 'http://127.0.0.1:8545';

    // Save to backend directory for auto-loading
    const backendEnvPath = path.join(__dirname, '../../backend/.env');
    if (fs.existsSync(backendEnvPath)) {
        let envContent = fs.readFileSync(backendEnvPath, 'utf8');

        // Update CONTRACT_ADDRESS
        envContent = envContent.replace(
            /CONTRACT_ADDRESS=.*/,
            `CONTRACT_ADDRESS=${address}`
        );

        // Update RPC_URL
        envContent = envContent.replace(
            /RPC_URL=.*/,
            `RPC_URL=${rpcUrl}`
        );

        fs.writeFileSync(backendEnvPath, envContent);
        console.log("✅ Backend .env updated with contract address and RPC URL");
        console.log(`   Network: ${networkName}`);
        console.log(`   RPC URL: ${rpcUrl}`);
    }

    // Save deployment config
    const deploymentConfig = {
        address: address,
        network: networkName,
        chainId: Number(network.chainId),
        deployedAt: new Date().toISOString(),
        contractName: 'CertificateRegistry'
    };
    fs.writeFileSync(
        'deployment-config.json',
        JSON.stringify(deploymentConfig, null, 2)
    );
    console.log("Deployment config saved to deployment-config.json");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });