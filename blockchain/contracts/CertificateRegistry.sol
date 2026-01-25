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
    
    function addInstitution(address institution) external onlyAdmin {
        authorizedInstitutions[institution] = true;
    }
    
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
    
    function revokeCertificate(string memory certId) external onlyAuthorized {
        require(certificates[certId].exists, "Certificate does not exist");
        require(!certificates[certId].isRevoked, "Already revoked");
        
        certificates[certId].isRevoked = true;
        emit CertificateRevoked(certId);
    }
    
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
}