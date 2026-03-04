// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract CertificateRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {
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

    // We no longer need a manual 'admin' variable, as Ownable provides 'owner()'
    // However, to avoid breaking the frontend/backend that might expect 'admin()',
    // we can keep an admin variable or just rely on owner()
    // The backend ABI currently doesn't call 'admin' directly, so we're safe to remove it
    // Wait, the previous contract had `address public admin;`
    // If we remove it, the interface changes slightly but backend doesn't seem to use it.
    address public admin;

    // Events (now with 'indexed' for faster queries)
    event CertificateIssued(string indexed certId, string studentName);
    event CertificateRevoked(string indexed certId);
    event InstitutionAdded(address indexed institution);
    event InstitutionRemoved(address indexed institution);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // Custom modifier to replace the old 'onlyAdmin'
    modifier onlyAuthorized() {
        require(authorizedInstitutions[msg.sender], "Not authorized");
        _;
    }

    function initialize() initializer public {
        __Ownable_init();
        __UUPSUpgradeable_init();

        admin = msg.sender;
        authorizedInstitutions[msg.sender] = true;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

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

    // NEW FUNCTION: Batch issuance for massive gas savings
    function batchIssueCertificates(
        string[] memory certIds,
        string[] memory studentNames,
        string[] memory courses,
        string[] memory grades
    ) external onlyAuthorized {
        uint256 length = certIds.length;
        require(
            studentNames.length == length &&
            courses.length == length &&
            grades.length == length,
            "Array lengths must match"
        );

        for (uint256 i = 0; i < length; i++) {
            require(!certificates[certIds[i]].exists, "Certificate already exists");

            certificates[certIds[i]] = Certificate({
                studentName: studentNames[i],
                course: courses[i],
                grade: grades[i],
                issueDate: block.timestamp,
                isRevoked: false,
                exists: true
            });

            emit CertificateIssued(certIds[i], studentNames[i]);
        }
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