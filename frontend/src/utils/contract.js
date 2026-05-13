import { ethers } from 'ethers';

// The address from the local deployment (update this if redeployed)
// In a real app, you might fetch this from an API or env var
export const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// Contract ABI (just the functions we need)
const CONTRACT_ABI = [
    "function issueCertificate(string certId, string metadataCID) external payable",
    "function batchIssueCertificates(string[] certIds, string[] metadataCIDs) external payable",
    "function revokeCertificate(string certId) external",
    "function verifyCertificate(string certId) external view returns (string metadataCID, uint256 issueDate, bool isRevoked)",
    "function authorizedInstitutions(address) external view returns (bool)",
    "function issuanceFee() external view returns (uint256)",
    "function owner() external view returns (address)"
];


// Get contract instance connected to signer (for write operations)
export const getContractWithSigner = (signer) => {
    return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
};

// Get contract instance connected to provider (for read operations)
export const getContractWithProvider = (provider) => {
    return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
};

// Check if an address is authorized to issue/revoke
export const checkAuthorization = async (provider, address) => {
    try {
        const contract = getContractWithProvider(provider);
        const [isInst, ownerAddr] = await Promise.all([
            contract.authorizedInstitutions(address).catch(() => false),
            contract.owner().catch(() => null),
        ]);
        if (isInst) return true;
        if (ownerAddr && address.toLowerCase() === ownerAddr.toLowerCase()) return true;
        return false;
    } catch (error) {
        console.error("Failed to check authorization:", error);
        return false;
    }
};

// Issue certificate via MetaMask with payment
export const issueCertificateOnChain = async (signer, certId, metadataCID) => {
    const contract = getContractWithSigner(signer);

    // 1. Fetch current issuance fee from contract
    let fee;
    try {
        fee = await contract.issuanceFee();
        console.log(`Current issuance fee: ${ethers.formatEther(fee)} ETH`);
    } catch (error) {
        console.error("Failed to fetch issuance fee:", error);
        throw new Error("Could not determine issuance fee. Please check your network connection.");
    }

    // 2. Estimate gas first to catch errors early (like not authorized or insufficient funds)
    try {
        await contract.issueCertificate.estimateGas(certId, metadataCID, { value: fee });
    } catch (error) {
        if (error.message.includes("Insufficient payment")) {
            throw new Error("Insufficient payment for issuance fee.");
        }
        throw new Error("Transaction would fail. Are you authorized to issue certificates on this network?");
    }

    // 3. Send transaction with the required fee (MetaMask will prompt user)
    const tx = await contract.issueCertificate(certId, metadataCID, { value: fee });

    // 4. Wait for confirmation
    const receipt = await tx.wait();

    return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
    };
};

// Batch issue certificates via MetaMask with payment
export const batchIssueCertificatesOnChain = async (signer, certIds, metadataCIDs) => {
    const contract = getContractWithSigner(signer);

    // 1. Fetch current issuance fee
    const feePerCert = await contract.issuanceFee();
    // eslint-disable-next-line no-undef
    const totalFee = feePerCert * BigInt(certIds.length);

    console.log(`Total batch fee for ${certIds.length} certs: ${ethers.formatEther(totalFee)} ETH`);

    // 2. Send transaction
    const tx = await contract.batchIssueCertificates(certIds, metadataCIDs, { value: totalFee });
    const receipt = await tx.wait();

    return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
    };
};

// Revoke certificate via MetaMask
export const revokeCertificateOnChain = async (signer, certId) => {
    const contract = getContractWithSigner(signer);

    try {
        try {
            const [, , isRevoked] = await contract.verifyCertificate(certId);
            if (isRevoked) {
                throw new Error("Certificate is already revoked on the blockchain.");
            }
        } catch (verifyErr) {
            if (verifyErr.message && verifyErr.message.includes("does not exist")) {
                throw new Error("Certificate does not exist on the blockchain. The local blockchain node may have been reset.");
            }
            // Ignore other verify errors and let estimateGas handle it
        }

        await contract.revokeCertificate.estimateGas(certId);
    } catch (error) {
        throw new Error(error.message || "Transaction would fail. Are you authorized, or is the certificate ID invalid/already revoked?");
    }

    const tx = await contract.revokeCertificate(certId);
    const receipt = await tx.wait();

    return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
    };
};
