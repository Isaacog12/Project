// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract CertificateRegistry is Ownable {
    struct Certificate {
        string metadataCID;
        uint256 issueDate;
        bool isRevoked;
        bool exists;
    }

    // Registry management
    mapping(string => Certificate) public certificates;
    mapping(address => bool) public authorizedInstitutions;
    uint256 public issuanceFee; // Fee per certificate issued

    // Events
    event CertificateIssued(string indexed certId, string metadataCID);
    event CertificateRevoked(string indexed certId);
    event InstitutionAdded(address indexed institution);
    event InstitutionRemoved(address indexed institution);
    event FeeUpdated(uint256 newFee);

    constructor() Ownable() {
        authorizedInstitutions[msg.sender] = true;
        issuanceFee = 0.001 ether; // Default fee
    }

    // Admin functions
    function setIssuanceFee(uint256 newFee) external onlyOwner {
        issuanceFee = newFee;
        emit FeeUpdated(newFee);
    }

    function withdrawFees() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    // Allow owner (admin) to add new institutions
    function addInstitution(address institution) external onlyOwner {
        authorizedInstitutions[institution] = true;
        emit InstitutionAdded(institution);
    }

    // Allow owner (admin) to remove institutions
    function removeInstitution(address institution) external onlyOwner {
        authorizedInstitutions[institution] = false;
        emit InstitutionRemoved(institution);
    }

    // Custom modifier to replace the old 'onlyAdmin'
    modifier onlyAuthorized() {
        require(authorizedInstitutions[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    function issueCertificate(
        string memory certId,
        string memory metadataCID
    ) external payable onlyAuthorized {
        require(msg.value >= issuanceFee, "Insufficient payment for issuance fee");
        require(!certificates[certId].exists, "Already exists");

        certificates[certId] = Certificate({
            metadataCID: metadataCID,
            issueDate: block.timestamp,
            isRevoked: false,
            exists: true
        });

        emit CertificateIssued(certId, metadataCID);
    }

    // Batch issuance for massive gas savings
    function batchIssueCertificates(
        string[] memory certIds,
        string[] memory metadataCIDs
    ) external payable onlyAuthorized {
        uint256 length = certIds.length;
        require(metadataCIDs.length == length, "Array lengths must match");
        require(msg.value >= issuanceFee * length, "Insufficient payment for batch issuance fees");

        for (uint256 i = 0; i < length; i++) {
            require(!certificates[certIds[i]].exists, "Certificate already exists");

            certificates[certIds[i]] = Certificate({
                metadataCID: metadataCIDs[i],
                issueDate: block.timestamp,
                isRevoked: false,
                exists: true
            });

            emit CertificateIssued(certIds[i], metadataCIDs[i]);
        }
    }

    function revokeCertificate(string memory certId) external onlyAuthorized {
        require(certificates[certId].exists, "Certificate does not exist");
        require(!certificates[certId].isRevoked, "Already revoked");

        certificates[certId].isRevoked = true;

        emit CertificateRevoked(certId);
    }

    function verifyCertificate(string memory certId) external view returns (
        string memory metadataCID,
        uint256 issueDate,
        bool isRevoked
    ) {
        require(certificates[certId].exists, "Certificate does not exist");

        Certificate memory cert = certificates[certId];
        return (cert.metadataCID, cert.issueDate, cert.isRevoked);
    }

    // Batch verification for performance optimization
    function batchVerifyCertificates(string[] memory certIds) external view returns (
        string[] memory metadataCIDs,
        uint256[] memory issueDates,
        bool[] memory isRevokedStatuses
    ) {
        uint256 length = certIds.length;
        metadataCIDs = new string[](length);
        issueDates = new uint256[](length);
        isRevokedStatuses = new bool[](length);

        for (uint256 i = 0; i < length; i++) {
            if (certificates[certIds[i]].exists) {
                Certificate memory cert = certificates[certIds[i]];
                metadataCIDs[i] = cert.metadataCID;
                issueDates[i] = cert.issueDate;
                isRevokedStatuses[i] = cert.isRevoked;
            }
        }
    }
}