import { ethers } from 'ethers';

// Helper to check if MetaMask is installed
export const isMetaMaskInstalled = () => {
    return typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask;
};

// Check if wallet is already connected
export const getConnectedWallet = async () => {
    if (!isMetaMaskInstalled()) return null;

    try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const network = await provider.getNetwork();

            return {
                address: accounts[0],
                provider,
                signer,
                chainId: Number(network.chainId)
            };
        }
    } catch (error) {
        console.error("Error checking connected wallet:", error);
    }
    return null;
};

// Connect wallet
export const connectWallet = async () => {
    if (!isMetaMaskInstalled()) {
        throw new Error("MetaMask is not installed. Please install it to use this feature.");
    }

    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const network = await provider.getNetwork();

        return {
            address: accounts[0],
            provider,
            signer,
            chainId: Number(network.chainId)
        };
    } catch (error) {
        if (error.code === 4001) {
            throw new Error("User rejected the connection request.");
        }
        throw new Error("Failed to connect wallet: " + error.message);
    }
};

// Request switch to specific network (e.g. 1337 for local Hardhat)
export const switchToNetwork = async (targetChainId) => {
    if (!isMetaMaskInstalled()) return false;

    const targetChainIdHex = `0x${targetChainId.toString(16)}`;

    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: targetChainIdHex }],
        });
        return true;
    } catch (switchError) {
        // This error code indicates that the chain has not been added to MetaMask.
        if (switchError.code === 4902) {
            try {
                // If targeting local Hardhat (1337)
                if (targetChainId === 1337) {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [
                            {
                                chainId: targetChainIdHex,
                                chainName: 'Hardhat Localhost',
                                rpcUrls: ['http://127.0.0.1:8545'],
                                nativeCurrency: {
                                    name: 'Ethereum',
                                    symbol: 'ETH',
                                    decimals: 18
                                }
                            },
                        ],
                    });
                    return true;
                }
            } catch (addError) {
                console.error("Failed to add network:", addError);
                return false;
            }
        }
        console.error("Failed to switch network:", switchError);
        return false;
    }
};

// Abbreviate address for display
export const shortenAddress = (address) => {
    if (!address) return '';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};
