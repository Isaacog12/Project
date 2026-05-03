import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { ethers } from 'ethers';
import axios from 'axios';
import './App.css';
import { getConnectedWallet, connectWallet, switchToNetwork, shortenAddress } from './utils/wallet';
import { checkAuthorization, issueCertificateOnChain, revokeCertificateOnChain, CONTRACT_ADDRESS } from './utils/contract';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

import { NIGERIAN_UNIVERSITIES, NIGERIAN_COURSES } from './constants/universities';

/**
 * SecureCert - Blockchain-Based Credential Verification System
 * 
 * This application allows institutions to issue cryptographic certificates on-chain
 * and provides a global public verification portal for employers and students.
 * 
 * Main Features:
 * - Single & Bulk Certificate Issuance
 * - Automatic Email Delivery with PDF Attachments
 * - IPFS Decentralized Storage
 * - Real-time Administrative Analytics Dashboard
 */
const API_URL = process.env.REACT_APP_API_URL;


/**
 * Authentication context provider and layout wrapper.
 * Forces the application into a permanent light theme.
 */
function useTheme() {
    useEffect(() => {
        const root = window.document.documentElement;
        root.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    }, []);

    return ['light', () => { }];
}

// ============================================
// PREMIUM ERROR COMPONENT
// ============================================

function PremiumError({ type = 'error', title, message, icon, action }) {
    const errorTypes = {
        error: { bg: 'error-bg', iconDefault: '❌', color: '#ff4757' },
        notFound: { bg: 'notfound-bg', iconDefault: '🔍', color: '#ffa502' },
        revoked: { bg: 'revoked-bg', iconDefault: '🚫', color: '#ff6348' },
        timeout: { bg: 'timeout-bg', iconDefault: '⏱️', color: '#ff6b81' },
        network: { bg: 'network-bg', iconDefault: '🌐', color: '#ff7979' }
    };

    const errorConfig = errorTypes[type] || errorTypes.error;

    return (
        <div className={`premium-error ${errorConfig.bg}`}>
            <div className="error-content">
                <div className="error-icon-wrapper">
                    <div className="error-icon">{icon || errorConfig.iconDefault}</div>
                </div>
                <h3 className="error-title">{title}</h3>
                <p className="error-message">{message}</p>
                {action && (
                    <div className="error-action">
                        {action}
                    </div>
                )}
            </div>
        </div>
    );

}

// ============================================
// LEGAL MODAL COMPONENT
// ============================================

function LegalModal({ title, content, onClose }) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    {content}
                </div>
                <div className="modal-footer">
                    <button className="modal-close-btn" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}

// ============================================
// SEARCHABLE DROPDOWN COMPONENT
// ============================================

function SearchableDropdown({ options, value, onChange, placeholder, icon = "🏛️" }) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const dropdownRef = React.useRef(null);

    const filteredOptions = options.filter(opt =>
        opt.toLowerCase().includes(searchTerm.toLowerCase())
    );

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSelect = (option) => {
        onChange(option);
        setIsOpen(false);
        setSearchTerm("");
    };

    return (
        <div className="searchable-dropdown" ref={dropdownRef}>
            <div className={`dropdown-trigger ${isOpen ? 'active' : ''}`} onClick={() => setIsOpen(!isOpen)}>
                <span className="input-icon-span">{icon}</span>
                <div className={`trigger-value ${!value ? 'placeholder' : ''}`}>{value || placeholder}</div>
                <span className="dropdown-caret">▼</span>
            </div>

            {isOpen && (
                <div className="dropdown-menu">
                    <div className="search-input-container">
                        <input
                            type="text"
                            placeholder="Search institution..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                    <div className="options-list">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((opt, index) => (
                                <div
                                    key={index}
                                    className={`option-item ${opt === value ? 'selected' : ''}`}
                                    onClick={() => handleSelect(opt)}
                                >
                                    {opt}
                                </div>
                            ))
                        ) : (
                            <div className="no-options">No institutions found</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================
// WALLET BUTTON COMPONENT
// ============================================

function WalletButton({ walletState, setWalletState, isAuthorized }) {
    const [connecting, setConnecting] = useState(false);

    const handleConnect = async () => {
        setConnecting(true);
        try {
            const wallet = await connectWallet();
            // Default check is for Hardhat Local (1337)
            if (wallet.chainId !== 1337) {
                const switched = await switchToNetwork(1337);
                if (switched) {
                    wallet.chainId = 1337;
                }
            }
            setWalletState(wallet);
        } catch (error) {
            alert(error.message);
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = () => {
        setWalletState(null);
    };

    if (!walletState) {
        return (
            <button className="wallet-btn connect" onClick={handleConnect} disabled={connecting}>
                {connecting ? 'Connecting...' : '🧭 Connect Wallet'}
            </button>
        );
    }

    const isCorrectNetwork = walletState.chainId === 1337;

    return (
        <div className="wallet-connected-container">
            <div className={`network-badge ${isCorrectNetwork ? 'valid' : 'invalid'}`}
                onClick={() => !isCorrectNetwork && switchToNetwork(1337)}>
                <span className="network-dot"></span>
                {isCorrectNetwork ? 'Local Node' : 'Wrong Network'}
            </div>
            <div className="wallet-address-badge">
                <span className="address-text">{shortenAddress(walletState.address)}</span>
                {isAuthorized ? <span className="auth-star" title="Authorized Admin">⭐ (Auth OK)</span> : <span className="auth-error-badge" style={{color: '#ff4757', fontSize: '0.7rem', marginLeft: '4px'}}>⚠️ (Not Auth)</span>}
                <button className="disconnect-icon" onClick={handleDisconnect} title="Disconnect">✕</button>
            </div>
        </div>
    );
}

// ============================================
// PUBLIC VERIFICATION PAGE
// ============================================

function PublicVerifyPage() {
    const { certId } = useParams();
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [downloadLoading, setDownloadLoading] = useState({ doc: false, pdf: false });

    useEffect(() => {
        const verifyOnLoad = async () => {
            try {
                const response = await axios.get(`${API_URL}/certificates/verify/${certId}`);
                setResult(response.data);
            } catch (error) {
                setResult({ error: error.response?.data?.error || error.message });
            } finally {
                setLoading(false);
            }
        };

        if (certId) {
            verifyOnLoad();
        }
    }, [certId]);

    const handleViewPDF = async () => {
        setDownloadLoading(prev => ({ ...prev, pdf: true }));
        try {
            const response = await axios.get(`${API_URL}/certificates/${certId}/pdf?view=true`, {
                responseType: 'blob'
            });
            // The response.data is already a Blob because of responseType: 'blob'
            const url = window.URL.createObjectURL(response.data);
            window.open(url, '_blank');
            // Give the browser some time to open the URL before revoking
            setTimeout(() => window.URL.revokeObjectURL(url), 60000);
        } catch (error) {
            console.error('View PDF error:', error);
            alert(`Failed to view certificate PDF: ${error.message}`);
        } finally {
            setDownloadLoading(prev => ({ ...prev, pdf: false }));
        }
    };

    const handleDownloadPDF = async () => {
        setDownloadLoading(prev => ({ ...prev, pdf: true }));
        try {
            const response = await axios.get(`${API_URL}/certificates/${certId}/pdf`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(response.data);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${certId}_certificate.pdf`);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download PDF error:', error);
            alert(`Failed to download certificate PDF: ${error.message}`);
        } finally {
            setDownloadLoading(prev => ({ ...prev, pdf: false }));
        }
    };

    const handleDownloadDoc = async () => {
        setDownloadLoading(prev => ({ ...prev, doc: true }));
        try {
            const response = await axios.get(`${API_URL}/certificates/download/${certId}`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(response.data);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `stamped_${certId}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download document error:', error);
            alert(`Failed to download document: ${error.message}`);
        } finally {
            setDownloadLoading(prev => ({ ...prev, doc: false }));
        }
    };

    return (
        <div className="App">
            <header>
                <div className="hero-section">
                    <div className="hero-top-bar">
                        <div className="hero-badge">✨ Blockchain Verified Credentials</div>
                    </div>
                    <h1 className="hero-title">Secure<span className="gradient-text">Cert</span></h1>
                    <p className="hero-subtitle">The gold standard in decentralized academic verification. Immutable, instant, and globally recognized.</p>
                </div>
            </header>

            <div className="container">
                <div className="section">
                    <div className="verify-header">
                        <h2>Certificate ID: <span className="cert-id-display">{certId}</span></h2>
                        <Link to={localStorage.getItem('adminToken') ? "/dashboard" : "/"} className="back-link">
                            ← Back to {localStorage.getItem('adminToken') ? "Dashboard" : "Home"}
                        </Link>
                    </div>

                    {loading ? (
                        <div className="loading-spinner">
                            <div className="spinner"></div>
                            <p>Verifying certificate on blockchain...</p>
                        </div>
                    ) : result?.error ? (
                        <PremiumError
                            type={result.error.includes('timeout') || result.error.includes('TIMEOUT') ? 'timeout' : result.error.includes('network') || result.error.includes('connect') ? 'network' : 'error'}
                            title="Verification Failed"
                            message={result.error}
                            action={
                                <button className="retry-btn" onClick={() => window.location.reload()}>
                                    🔄 Try Again
                                </button>
                            }
                        />
                    ) : !result?.exists ? (
                        <PremiumError
                            type="notFound"
                            title="Certificate Not Found"
                            message="This certificate does not exist on the blockchain. Please check the certificate ID and try again."
                            action={
                                <Link to={localStorage.getItem('adminToken') ? "/dashboard" : "/"} className="home-btn">
                                    ← Back to {localStorage.getItem('adminToken') ? "Dashboard" : "Home"}
                                </Link>
                            }
                        />
                    ) : result?.isRevoked ? (
                        <PremiumError
                            type="revoked"
                            title="Certificate Revoked"
                            message="This certificate has been revoked and is no longer valid. The record remains on the blockchain but the certificate is not recognized."
                        />
                    ) : (
                        <div className="result success">
                            <div className="verification-badge">
                                <div className="badge-icon">✅</div>
                                <span>BLOCKCHAIN VERIFIED</span>
                            </div>

                            <div className="cert-card">
                                <div className="cert-card-content">
                                    <div className="cert-info">
                                        <div className="university-logo-container">
                                            <img 
                                                src={`/university_logos/${result.institution}.png`} 
                                                alt={`${result.institution} Logo`} 
                                                className="university-logo"
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.src = "/logo1.jpg"; // fallback
                                                }}
                                            />
                                        </div>
                                        <div className="info-row">
                                            <label>Student Name</label>
                                            <span className="value large">{result.studentName}</span>
                                        </div>
                                        <div className="info-row">
                                            <label>Course</label>
                                            <span className="value">{result.course}</span>
                                        </div>
                                        <div className="info-row">
                                            <label>Grade</label>
                                            <span className="value highlight">{result.grade}</span>
                                        </div>
                                        <div className="info-row">
                                            <label>Issue Date</label>
                                            <span className="value">{
                                                typeof result.issueDate === 'string'
                                                    ? new Date(result.issueDate).toLocaleDateString('en-US', {
                                                        year: 'numeric',
                                                        month: 'long',
                                                        day: 'numeric'
                                                    })
                                                    : new Date(result.issueDate * 1000).toLocaleDateString('en-US', {
                                                        year: 'numeric',
                                                        month: 'long',
                                                        day: 'numeric'
                                                    })
                                            }</span>
                                        </div>
                                        {result.ipfsCID && (
                                            <div className="info-row">
                                                <label>Metadata (IPFS)</label>
                                                <span className="value mono highlight">{result.ipfsCID.substring(0, 15)}...</span>
                                            </div>
                                        )}
                                        {result.txHash && (
                                            <div className="info-row">
                                                <label>Transaction</label>
                                                <span className="value mono">{result.txHash.substring(0, 20)}...</span>
                                            </div>
                                        )}
                                    </div>

                                    {result.qrCode && (
                                        <div className="qr-section">
                                            <img src={result.qrCode} alt="Verification QR Code" className="qr-code" />
                                            <p className="qr-label">Scan to verify</p>
                                        </div>
                                    )}
                                </div>

                                <div className="download-actions">
                                    <button className="download-btn secondary" onClick={handleViewPDF} disabled={downloadLoading.pdf}>
                                        {downloadLoading.pdf ? '⏳...' : '👁️ View PDF'}
                                    </button>
                                    <button className="download-btn primary" onClick={handleDownloadPDF} disabled={downloadLoading.pdf}>
                                        {downloadLoading.pdf ? '⏳...' : '📜 Download PDF'}
                                    </button>
                                    {result.hasDocument && (
                                        <button className="download-btn secondary" onClick={handleDownloadDoc} disabled={downloadLoading.doc}>
                                            {downloadLoading.doc ? '⏳ Downloading...' : '📄 Download Stamped Document'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================
// MAIN APP COMPONENT
// ============================================

// ============================================
// ISSUE CERTIFICATE COMPONENT
// ============================================

function IssueForm({ walletState, isAuthorized, issuanceFee }) {
    const [studentName, setStudentName] = useState('');
    const [institution, setInstitution] = useState('');
    const [course, setCourse] = useState('');
    const [grade, setGrade] = useState('');
    const [document, setDocument] = useState(null);
    const [issueMode, setIssueMode] = useState('single'); // 'single' or 'bulk'
    const [csvFile, setCsvFile] = useState(null);
    const [issueResult, setIssueResult] = useState(null);
    const [issueLoading, setIssueLoading] = useState(false);
    const navigate = useNavigate();

    const getDegreeClassInfo = (cgpa) => {
        const score = parseFloat(cgpa);
        if (isNaN(score)) return null;
        if (score >= 4.50) return { label: 'First Class Honours', icon: '🏆', color: '#fbbf24' };
        if (score >= 3.50) return { label: 'Second Class Honours (Upper Division)', icon: '🥈', color: '#e2e8f0' };
        if (score >= 2.40) return { label: 'Second Class Honours (Lower Division)', icon: '🥉', color: '#94a3b8' };
        if (score >= 1.50) return { label: 'Third Class Honours', icon: '📜', color: '#d1d5db' };
        if (score >= 1.00) return { label: 'Pass', icon: '✅', color: '#4ade80' };
        return { label: 'Fail', icon: '❌', color: '#f87171' };
    };

    const classInfo = getDegreeClassInfo(grade);

    const handleIssue = async (e) => {
        e.preventDefault();

        if (!institution) {
            setIssueResult({ error: "Please select an institution before issuing a certificate." });
            return;
        }

        setIssueLoading(true);
        setIssueResult(null);

        try {
            const formData = new FormData();
            formData.append('studentName', studentName);
            formData.append('course', course);
            // Send standard format: "First Class Honours (4.50)"
            const info = getDegreeClassInfo(grade);
            const formattedGrade = info ? `${info.label} (${grade})` : grade;
            formData.append('grade', formattedGrade);

            if (document) {
                formData.append('document', document);
            }

            // Enforce MetaMask and Authorization
            if (!walletState || !walletState.signer) {
                setIssueLoading(false);
                return setIssueResult({ error: "Please connect your Web3 wallet (e.g. MetaMask) to pay the issuance fee." });
            }
            
            if (!isAuthorized) {
                setIssueLoading(false);
                return setIssueResult({ error: "Your connected wallet address is not authorized to issue certificates on this contract." });
            }

            // 1. PIN Metadata to IPFS FIRST (Facilitates Privacy & Decentralization)
            setIssueResult({ status: 'pinning', message: 'Pinning metadata to IPFS...' });

            const pinResponse = await axios.post(`${API_URL}/certificates/pin-metadata`, {
                studentName,
                institution,
                course,
                grade: formattedGrade
            }, {
                headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` }
            });

            const { certId, metadataCID } = pinResponse.data;

            // 2. Send transaction via MetaMask
            setIssueResult({ status: 'waiting_wallet', message: 'Please confirm the transaction in your wallet...' });

            const txData = await issueCertificateOnChain(
                walletState.signer,
                certId,
                metadataCID
            );

            setIssueResult({ status: 'waiting_backend', message: 'Transaction confirmed. Saving to database...' });

            // 3. Send to backend metadata endpoint (to generate PDF and store local record)
            formData.append('certId', certId);
            formData.append('institution', institution);
            formData.append('txHash', txData.txHash);
            formData.append('issueDate', new Date().toISOString());
            formData.append('metadataCID', metadataCID);

            const response = await axios.post(`${API_URL}/certificates/issue-metadata`, formData);

            // Add the metamask flag to the result
            setIssueResult({ ...response.data, byMetaMask: true });

            setStudentName('');
            setCourse('');
            setGrade('');
            setDocument(null);
            const fileInput = window.document.getElementById('document-input');
            if (fileInput) fileInput.value = '';
        } catch (error) {
            setIssueResult({ error: error.response?.data?.error || error.message });
        } finally {
            setIssueLoading(false);
        }
    };

    const handleBulkIssue = async (e) => {
        e.preventDefault();
        if (!institution) return setIssueResult({ error: "Please select an institution first." });
        if (!csvFile) return setIssueResult({ error: "Please upload a CSV file." });

        setIssueLoading(true);
        setIssueResult(null);

        try {
            const formData = new FormData();
            formData.append('csvFile', csvFile);
            formData.append('institution', institution);

            const token = localStorage.getItem('adminToken');
            const response = await axios.post(`${API_URL}/admin/certificates/bulk-issue`, formData, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setIssueResult({ ...response.data, isBulk: true });
            setCsvFile(null);
            const fileInput = window.document.getElementById('csv-input');
            if (fileInput) fileInput.value = '';
        } catch (err) {
            setIssueResult({ error: err.response?.data?.error || err.message });
        } finally {
            setIssueLoading(false);
        }
    };

    const goToPublicVerify = (id) => {
        navigate(`/verify/${id}`);
    };

    return (
        <div className="section issue-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ margin: 0 }}>Issue Certificate</h2>
                <div className="toggle-group" style={{ display: 'flex', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '12px' }}>
                    <button
                        type="button"
                        className={`toggle-btn ${issueMode === 'single' ? 'active' : ''}`}
                        onClick={() => setIssueMode('single')}
                        style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: issueMode === 'single' ? 'var(--aurora-primary)' : 'transparent', color: issueMode === 'single' ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}
                    >Single</button>
                    <button
                        type="button"
                        className={`toggle-btn ${issueMode === 'bulk' ? 'active' : ''}`}
                        onClick={() => setIssueMode('bulk')}
                        style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: issueMode === 'bulk' ? 'var(--aurora-primary)' : 'transparent', color: issueMode === 'bulk' ? '#fff' : 'var(--text-muted)', cursor: 'pointer' }}
                    >Bulk (CSV)</button>
                </div>
            </div>

            <form onSubmit={issueMode === 'single' ? handleIssue : handleBulkIssue}>
                <div className="form-group">
                    <SearchableDropdown
                        options={NIGERIAN_UNIVERSITIES}
                        value={institution}
                        onChange={setInstitution}
                        placeholder="Pick your university"
                        icon="🏛️"
                    />
                </div>

                {issueMode === 'single' ? (
                    <>
                        <div className="form-group">
                            <div className="input-wrapper">
                                <span className="input-icon-span">👤</span>
                                <input type="text" placeholder="Student Name" value={studentName} onChange={(e) => setStudentName(e.target.value)} required />
                            </div>
                        </div>
                        <div className="form-group">
                            <SearchableDropdown
                                options={NIGERIAN_COURSES}
                                value={course}
                                onChange={setCourse}
                                placeholder="Pick your course / department"
                                icon="🎓"
                            />
                        </div>
                        <div className="grade-input-group">
                            <div className="input-wrapper">
                                <span className="input-icon-span">📊</span>
                                <input type="number" step="0.01" min="0" max="5" placeholder="Enter CGPA (e.g. 4.5)" value={grade} onChange={(e) => setGrade(e.target.value)} required />
                            </div>
                            {classInfo && (
                                <div className="grade-preview">
                                    <span className="preview-icon">{classInfo.icon}</span>
                                    <div>
                                        <span className="preview-label">Calculated Degree Class</span>
                                        <span className="preview-value" style={{ color: classInfo.color }}>
                                            {classInfo.label}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="form-group file-upload">
                            <label htmlFor="document-input" className="file-label">
                                {document ? `📄 ${document.name}` : '📎 Optional: Upload Stamped Result Document (PDF/JPG)'}
                            </label>
                            <input
                                id="document-input"
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png"
                                className="file-input"
                                onChange={(e) => setDocument(e.target.files[0])}
                            />
                        </div>
                    </>
                ) : (
                    <div className="form-group file-upload" style={{ marginTop: '20px' }}>
                        <div style={{ padding: '20px', background: 'rgba(139, 92, 246, 0.05)', borderRadius: '12px', marginBottom: '20px', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                            <h4 style={{ margin: '0 0 10px 0', color: 'var(--aurora-primary)' }}>CSV Format Requirements</h4>
                            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Your CSV must include exactly these column headers: <br />
                                <code style={{ background: '#000', padding: '2px 6px', borderRadius: '4px' }}>studentName, course, grade</code>.</p>
                        </div>
                        <label htmlFor="csv-input" className="file-label" style={{ padding: '40px 20px', borderStyle: 'dashed', borderWidth: '2px', borderColor: csvFile ? 'var(--status-success)' : 'var(--aurora-primary)' }}>
                            <span style={{ fontSize: '2rem', display: 'block', marginBottom: '10px' }}>{csvFile ? '✅' : '📁'}</span>
                            {csvFile ? `Selected: ${csvFile.name}` : 'Click to Upload Students CSV File'}
                        </label>
                        <input
                            id="csv-input"
                            type="file"
                            accept=".csv"
                            className="file-input"
                            onChange={(e) => setCsvFile(e.target.files[0])}
                            required
                        />
                    </div>
                )}

                {issuanceFee && (
                    <div style={{ textAlign: 'center', marginBottom: '16px', padding: '8px', background: 'rgba(18, 140, 126, 0.05)', borderRadius: '8px', border: '1px solid rgba(18, 140, 126, 0.1)' }}>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
                            <span style={{ fontSize: '1.1rem', marginRight: '6px' }}>💰</span>
                            Issuance Fee: <strong>{issuanceFee} ETH</strong> {issueMode === 'bulk' ? 'per certificate' : ''}
                        </p>
                    </div>
                )}

                <button type="submit" disabled={issueLoading || !walletState || (!isAuthorized && localStorage.getItem('adminToken') === null)}>
                    {issueLoading ? 'Processing...' : issueMode === 'single' ? 'Issue Certificate' : 'Run Bulk Issuance'}
                </button>
                {!walletState && (
                    <p style={{ color: '#ff4757', fontSize: '0.85rem', marginTop: '12px', textAlign: 'center', fontWeight: '500' }}>
                        ⚠️ Please connect your MetaMask wallet to issue certificates.
                    </p>
                )}
            </form>

            {issueResult && (
                <div className={`result ${issueResult.error ? 'error' : (issueResult.status ? 'pending' : 'success')}`}>
                    {issueResult.error ? (
                        <PremiumError
                            type={issueResult.error.includes('timeout') || issueResult.error.includes('TIMEOUT') ? 'timeout' : issueResult.error.includes('network') || issueResult.error.includes('connect') ? 'network' : 'error'}
                            title="Failed to Issue Certificate"
                            message={issueResult.error}
                            action={
                                <button className="retry-btn" onClick={() => setIssueResult(null)}>
                                    ← Try Again
                                </button>
                            }
                        />
                    ) : issueResult.status ? (
                        <div className="issue-pending">
                            <div className="loading-spinner">
                                <div className="spinner"></div>
                                <p>{issueResult.message}</p>
                            </div>
                        </div>
                    ) : (
                        <div className="issue-success">
                            <div className="success-header">
                                <div className="big-icon">✅</div>
                                <h3>Certificate Issued Successfully!</h3>
                                <p><strong>Message:</strong> {issueResult.message}</p>
                                {issueResult.isBulk && <p><strong>Status:</strong> Processing automatically in the background...</p>}

                                {!issueResult.isBulk && issueResult.byMetaMask && (
                                    <div className="metamask-badge">🦊 Signed via MetaMask</div>
                                )}
                            </div>

                            <div className="issue-details">
                                {!issueResult.isBulk && (
                                    <>
                                        <div className="detail-row">
                                            <label>Certificate ID</label>
                                            <span className="cert-id-value">{issueResult.certId}</span>
                                        </div>
                                        {issueResult.issueDate && (
                                            <div className="detail-row">
                                                <label>Issue Date</label>
                                                <span>{new Date(issueResult.issueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                            </div>
                                        )}
                                    </>
                                )}

                                {issueResult.qrCode && (
                                    <div className="qr-section">
                                        <img src={issueResult.qrCode} alt="QR Code" className="qr-code" />
                                        <p className="qr-label">Scan to verify</p>
                                    </div>
                                )}

                                {!issueResult.isBulk && (
                                    <div className="issue-actions">
                                        <button className="action-link" onClick={() => goToPublicVerify(issueResult.certId)}>
                                            🔗 Open Verification Portal
                                        </button>
                                        <button className="action-link secondary" onClick={() => {
                                            navigator.clipboard.writeText(issueResult.verifyUrl || `${window.location.origin}/verify/${issueResult.certId}`);
                                            alert('Link copied!');
                                        }}>
                                            📋 Copy Link
                                        </button>
                                    </div>
                                )}

                                {issueResult.hasDocument && <p className="note">📄 Document attached and stored</p>}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================
// VERIFY CERTIFICATE COMPONENT
// ============================================

/**
 * Public Verification Portal: Allows universal cryptographic status checks.
 * Integrates with IPFS for decentralized document retrieval.
 */
function VerifyForm() {
    const [certId, setCertId] = useState('');
    const [verifyResult, setVerifyResult] = useState(null);
    const [verifyLoading, setVerifyLoading] = useState(false);
    const [downloadLoading, setDownloadLoading] = useState({ doc: false, pdf: false });
    const navigate = useNavigate();

    const handleViewPDF = async () => {
        if (verifyResult?.ipfsCID) {
            window.open(`https://gateway.pinata.cloud/ipfs/${verifyResult.ipfsCID}`, '_blank');
            return;
        }

        setDownloadLoading(prev => ({ ...prev, pdf: true }));
        try {
            const response = await axios.get(`${API_URL}/certificates/${certId}/pdf?view=true`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            window.open(url, '_blank');
            setTimeout(() => window.URL.revokeObjectURL(url), 10000);
        } catch (error) {
            alert('Failed to view certificate PDF');
        } finally {
            setDownloadLoading(prev => ({ ...prev, pdf: false }));
        }
    };

    const handleVerify = async (e) => {
        e.preventDefault();
        setVerifyLoading(true);
        setVerifyResult(null);

        try {
            const response = await axios.get(`${API_URL}/certificates/verify/${certId}`);
            setVerifyResult(response.data);
        } catch (error) {
            setVerifyResult({ error: error.response?.data?.error || error.message });
        } finally {
            setVerifyLoading(false);
        }
    };

    const handleDownloadPDF = async () => {
        if (verifyResult?.ipfsCID) {
            const link = window.document.createElement('a');
            link.href = `https://gateway.pinata.cloud/ipfs/${verifyResult.ipfsCID}?download=true`;
            link.setAttribute('download', `${certId}_certificate.pdf`);
            window.document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            return;
        }

        setDownloadLoading(prev => ({ ...prev, pdf: true }));
        try {
            const response = await axios.get(`${API_URL}/certificates/${certId}/pdf`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = window.document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${certId}_certificate.pdf`);
            window.document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            alert('Failed to download certificate PDF');
        } finally {
            setDownloadLoading(prev => ({ ...prev, pdf: false }));
        }
    };

    const handleDownloadDoc = async () => {
        setDownloadLoading(prev => ({ ...prev, doc: true }));
        try {
            const response = await axios.get(`${API_URL}/certificates/download/${certId}`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = window.document.createElement('a');
            link.href = url;
            link.setAttribute('download', `stamped_${certId}.pdf`);
            window.document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            alert('Failed to download document');
        } finally {
            setDownloadLoading(prev => ({ ...prev, doc: false }));
        }
    };

    const goToPublicVerify = (id) => {
        navigate(`/verify/${id}`);
    };

    return (
        <div className="section cinematic-verify">
            <div className="cinematic-header">
                <span className="glow-icon">🛡️</span>
                <h2 className="cinematic-title">Global Credential Verification</h2>
                <p className="cinematic-subtitle">Instantly cryptographically verify any academic record on the blockchain.</p>
            </div>
            <form onSubmit={handleVerify} className="cinematic-search-form">
                <div className="cinematic-search-wrapper">
                    <span className="cinematic-search-icon">🔍</span>
                    <input
                        type="text"
                        placeholder="Enter the unique Certificate ID (e.g. CERT-...)"
                        value={certId}
                        onChange={(e) => setCertId(e.target.value)}
                        required
                        className="cinematic-search-input"
                    />
                    <button type="submit" disabled={verifyLoading} className="cinematic-search-btn">
                        {verifyLoading ? 'Scanning Ledger...' : 'Verify Record'}
                    </button>
                </div>
            </form>

            {verifyResult && (
                <div className={`result ${verifyResult.error ? 'error' : (verifyResult.exists && !verifyResult.isRevoked) ? 'success' : 'error'}`}>
                    {verifyResult.error ? (
                        <PremiumError
                            type={verifyResult.error.includes('timeout') || verifyResult.error.includes('TIMEOUT') ? 'timeout' : verifyResult.error.includes('network') || verifyResult.error.includes('connect') ? 'network' : 'error'}
                            title="Verification Failed"
                            message={verifyResult.error}
                            action={
                                <button className="retry-btn" onClick={() => setVerifyResult(null)}>
                                    ← Try Again
                                </button>
                            }
                        />
                    ) : !verifyResult.exists ? (
                        <PremiumError
                            type="notFound"
                            title="Certificate Not Found"
                            message="This certificate does not exist on the blockchain."
                        />
                    ) : verifyResult.isRevoked ? (
                        <PremiumError
                            type="revoked"
                            title="Certificate Revoked"
                            message="This certificate has been revoked and is no longer valid."
                        />
                    ) : (
                        <div className="cert-details">
                            <h3>✅ Valid Certificate</h3>
                            <p><strong>Student:</strong> {verifyResult.studentName}</p>
                            <p><strong>Institution:</strong> {verifyResult.institution}</p>
                            <p><strong>Course:</strong> {verifyResult.course}</p>
                            <p><strong>Grade:</strong> {verifyResult.grade}</p>
                            <p><strong>Issue Date:</strong> {new Date(verifyResult.issueDate * 1000).toLocaleDateString()}</p>

                            {verifyResult.qrCode && (
                                <div className="qr-section inline">
                                    <img src={verifyResult.qrCode} alt="QR Code" className="qr-code small" />
                                </div>
                            )}

                            <div className="download-actions">
                                <button className="download-btn secondary" onClick={handleViewPDF} disabled={downloadLoading.pdf}>
                                    {downloadLoading.pdf ? '⏳...' : '👁️ View PDF'}
                                </button>
                                <button className="download-btn" onClick={handleDownloadPDF} disabled={downloadLoading.pdf}>
                                    {downloadLoading.pdf ? '⏳...' : '📜 Download PDF'}
                                </button>
                                {verifyResult.hasDocument && (
                                    <button className="download-btn secondary" onClick={handleDownloadDoc} disabled={downloadLoading.doc}>
                                        {downloadLoading.doc ? '⏳ Downloading...' : '📄 Download Stamped Document'}
                                    </button>
                                )}
                            </div>

                            <button className="action-link" onClick={() => goToPublicVerify(certId)}>
                                🔗 Open Public Verification Page
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================
// ADMIN DASHBOARD COMPONENT
// ============================================

/**
 * Admin Panel: Comprehensive dashboard for certificate lifecycle management.
 * Includes data visualization, revocation controls, and institutional registry.
 */
function AdminDashboard({ walletState, isAuthorized }) {
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminToken, setAdminToken] = useState(localStorage.getItem('adminToken'));
    const [certificates, setCertificates] = useState([]);
    const [adminLoading, setAdminLoading] = useState(false);
    const [stats, setStats] = useState(null);
    const [actionLoading, setActionLoading] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCerts, setSelectedCerts] = useState(new Set());
    const [batchLoading, setBatchLoading] = useState(false);
    const navigate = useNavigate();

    // Derived Analytics from `certificates` array
    const COLORS = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#ede9fe', '#fbbf24', '#fcd34d', '#fde68a'];

    const gradeData = React.useMemo(() => {
        const counts = {};
        certificates.forEach(c => {
            let label = c.grade;
            if (c.grade.includes('First Class')) label = 'First Class';
            else if (c.grade.includes('Upper')) label = 'Second Class Upper';
            else if (c.grade.includes('Lower')) label = 'Second Class Lower';
            else if (c.grade.includes('Third')) label = 'Third Class';
            else if (c.grade.includes('Pass')) label = 'Pass';

            counts[label] = (counts[label] || 0) + 1;
        });
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [certificates]);

    const courseData = React.useMemo(() => {
        const counts = {};
        certificates.forEach(c => {
            counts[c.course] = (counts[c.course] || 0) + 1;
        });
        return Object.entries(counts)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);
    }, [certificates]);

    // Selection helpers
    const toggleSelect = (certId) => {
        setSelectedCerts(prev => {
            const next = new Set(prev);
            if (next.has(certId)) next.delete(certId);
            else next.add(certId);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedCerts.size === filteredCertificates.length) {
            setSelectedCerts(new Set());
        } else {
            setSelectedCerts(new Set(filteredCertificates.map(c => c.certId)));
        }
    };

    const clearSelection = () => setSelectedCerts(new Set());

    const loadAdminData = React.useCallback(async (token = adminToken) => {
        setAdminLoading(true);
        try {
            const [certsResponse, statsResponse] = await Promise.all([
                axios.get(`${API_URL}/admin/certificates`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                axios.get(`${API_URL}/admin/stats`, {
                    headers: { Authorization: `Bearer ${token}` }
                })
            ]);
            setCertificates(certsResponse.data);
            setStats(statsResponse.data);
        } catch (error) {
            console.error('Failed to load admin data:', error);
        } finally {
            setAdminLoading(false);
        }
    }, [adminToken]);

    const verifyToken = React.useCallback(async () => {
        try {
            await axios.get(`${API_URL}/auth/verify`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            setIsAdmin(true);
            loadAdminData(adminToken);
        } catch (error) {
            localStorage.removeItem('adminToken');
            setAdminToken(null);
            setIsAdmin(false);
            navigate('/login');
        }
    }, [adminToken, loadAdminData, navigate]);

    useEffect(() => {
        if (adminToken) {
            verifyToken();
        }
    }, [adminToken, verifyToken]);

    useEffect(() => {
        if (!isAdmin && !localStorage.getItem('adminToken')) {
            navigate('/login');
        }
    }, [isAdmin, navigate]);

    const handleLogout = () => {
        localStorage.removeItem('adminToken');
        setAdminToken(null);
        setIsAdmin(false);
        setCertificates([]);
        setStats(null);
        navigate('/login');
    };

    const handleRevoke = React.useCallback(async (certId) => {
        if (!window.confirm(`Are you sure you want to revoke certificate ${certId}?`)) return;

        setActionLoading(prev => ({ ...prev, [certId]: 'revoking' }));
        try {
            if (walletState && walletState.signer && isAuthorized) {
                await revokeCertificateOnChain(walletState.signer, certId);
            } else {
                await axios.post(`${API_URL}/admin/certificates/${certId}/revoke`, {}, {
                    headers: { Authorization: `Bearer ${adminToken}` }
                });
            }
            alert('Certificate revoked successfully');
            loadAdminData();
        } catch (error) {
            alert(error.response?.data?.error || 'Failed to revoke certificate');
        } finally {
            setActionLoading(prev => ({ ...prev, [certId]: null }));
        }
    }, [adminToken, loadAdminData, isAuthorized, walletState]);

    const handleDelete = React.useCallback(async (certId) => {
        if (!window.confirm(`Delete certificate ${certId} from database?`)) return;

        setActionLoading(prev => ({ ...prev, [certId]: 'deleting' }));
        try {
            await axios.delete(`${API_URL}/admin/certificates/${certId}`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            alert('Certificate deleted');
            loadAdminData();
        } catch (error) {
            alert(error.response?.data?.error || 'Failed to delete certificate');
        } finally {
            setActionLoading(prev => ({ ...prev, [certId]: null }));
        }
    }, [adminToken, loadAdminData]);

    // Batch revoke handler
    const handleBatchRevoke = async () => {
        const ids = Array.from(selectedCerts);
        if (!window.confirm(`Revoke ${ids.length} selected certificate(s)?`)) return;

        setBatchLoading(true);
        try {
            const response = await axios.post(`${API_URL}/admin/certificates/batch-revoke`, { certIds: ids }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            alert(response.data.message);
            clearSelection();
            loadAdminData();
        } catch (error) {
            alert(error.response?.data?.error || 'Batch revoke failed');
        } finally {
            setBatchLoading(false);
        }
    };

    // Batch delete handler
    const handleBatchDelete = async () => {
        const ids = Array.from(selectedCerts);
        if (!window.confirm(`DELETE ${ids.length} selected certificate(s)? This cannot be undone.`)) return;

        setBatchLoading(true);
        try {
            const response = await axios.post(`${API_URL}/admin/certificates/batch-delete`, { certIds: ids }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            alert(response.data.message);
            clearSelection();
            loadAdminData();
        } catch (error) {
            alert(error.response?.data?.error || 'Batch delete failed');
        } finally {
            setBatchLoading(false);
        }
    };

    const goToPublicVerify = (id) => {
        navigate(`/verify/${id}`);
    };

    // Filter certificates based on search query - MEMOIZED for performance
    const filteredCertificates = React.useMemo(() => {
        if (!searchQuery) return certificates;

        const query = searchQuery.toLowerCase();
        return certificates.filter(cert => {
            const studentName = (cert.blockchainData?.studentName || cert.studentName || '').toLowerCase();
            const course = (cert.blockchainData?.course || cert.course || '').toLowerCase();
            const grade = (cert.blockchainData?.grade || cert.grade || '').toLowerCase();
            const institution = (cert.institution || '').toLowerCase();
            const certIdString = (cert.certId || '').toLowerCase();

            return studentName.includes(query) ||
                course.includes(query) ||
                grade.includes(query) ||
                institution.includes(query) ||
                certIdString.includes(query);
        });
    }, [certificates, searchQuery]);

    if (!isAdmin) {
        return (
            <div className="section" style={{ minHeight: '400px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <div className="loading-spinner">
                    <div className="spinner"></div>
                    <p>Verifying admin credentials...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="section">
            <div className="admin-header">
                <h2>📊 Admin Dashboard</h2>
                <button className="logout-btn" onClick={handleLogout}>Logout</button>
            </div>

            {stats && (
                <div className="stats-grid">
                    <div className="stat-card">
                        <span className="stat-number">{stats.totalCertificates}</span>
                        <span className="stat-label">Total</span>
                    </div>
                    <div className="stat-card valid">
                        <span className="stat-number">{stats.validCertificates}</span>
                        <span className="stat-label">Valid</span>
                    </div>
                    <div className="stat-card revoked">
                        <span className="stat-number">{stats.revokedCertificates}</span>
                        <span className="stat-label">Revoked</span>
                    </div>
                    <div className="stat-card">
                        <span className="stat-number">{stats.documentsUploaded}</span>
                        <span className="stat-label">Documents</span>
                    </div>
                </div>
            )}

            {certificates.length > 0 && (
                <div className="dashboard-charts-grid">
                    <div className="chart-container">
                        <h3 className="chart-title">📊 Grade Distribution</h3>
                        <div className="chart-content">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={gradeData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={70}
                                        outerRadius={110}
                                        paddingAngle={5}
                                        dataKey="value"
                                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                    >
                                        {gradeData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="chart-container">
                        <h3 className="chart-title">📈 Top Issuing Departments</h3>
                        <div className="chart-content">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={courseData} margin={{ top: 20, right: 30, left: 0, bottom: 25 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                                    <XAxis
                                        dataKey="name"
                                        tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                                        tickFormatter={(val) => val.length > 15 ? val.substring(0, 15) + '...' : val}
                                        interval={0}
                                        angle={-20}
                                        textAnchor="end"
                                    />
                                    <YAxis tick={{ fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                                    <RechartsTooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#1f1f23', border: '1px solid #3f3f46' }} />
                                    <Bar dataKey="value" name="Certificates" radius={[6, 6, 0, 0]}>
                                        {courseData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            )}

            {/* Search Bar */}
            <div className="search-container">
                <div className="search-bar">
                    <div className="input-wrapper">
                        <span className="input-icon-span">🔍</span>
                        <input
                            type="text"
                            className="search-input"
                            placeholder="Search certificates..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    {searchQuery && (
                        <button
                            className="clear-search-btn"
                            onClick={() => setSearchQuery('')}
                            title="Clear search"
                        >
                            ✕
                        </button>
                    )}
                </div>
                {searchQuery && (
                    <p className="search-results-count">
                        Found {filteredCertificates.length} of {certificates.length} certificates
                    </p>
                )}
            </div>

            <h3>All Certificates</h3>

            {/* Bulk Action Toolbar */}
            {selectedCerts.size > 0 && (
                <div className="bulk-action-bar">
                    <div className="bulk-info">
                        <span className="bulk-count">{selectedCerts.size}</span> selected
                        <button className="bulk-clear-btn" onClick={clearSelection}>✕ Clear</button>
                    </div>
                    <div className="bulk-actions">
                        <button className="bulk-btn revoke" onClick={handleBatchRevoke} disabled={batchLoading}>
                            {batchLoading ? '⏳ Working...' : '🚫 Revoke Selected'}
                        </button>
                        <button className="bulk-btn delete" onClick={handleBatchDelete} disabled={batchLoading}>
                            {batchLoading ? '⏳ Working...' : '🗑️ Delete Selected'}
                        </button>
                    </div>
                </div>
            )}

            {adminLoading ? (
                <p className="loading">Loading...</p>
            ) : filteredCertificates.length === 0 ? (
                <p className="no-data">
                    {searchQuery ? `No certificates match "${searchQuery}"` : 'No certificates found'}
                </p>
            ) : (
                <div className="certificates-table">
                    <table>
                        <thead>
                            <tr>
                                <th className="checkbox-col">
                                    <input
                                        type="checkbox"
                                        checked={selectedCerts.size === filteredCertificates.length && filteredCertificates.length > 0}
                                        onChange={toggleSelectAll}
                                        title="Select all"
                                    />
                                </th>
                                <th>ID</th>
                                <th>Student</th>
                                <th>Institution</th>
                                <th>Course</th>
                                <th>Grade</th>
                                <th>Date Issued</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredCertificates.map((cert) => (
                                <tr key={cert.certId} className={`${cert.blockchainData?.isRevoked ? 'revoked-row' : ''} ${selectedCerts.has(cert.certId) ? 'selected-row' : ''}`}>
                                    <td className="checkbox-col">
                                        <input
                                            type="checkbox"
                                            checked={selectedCerts.has(cert.certId)}
                                            onChange={() => toggleSelect(cert.certId)}
                                        />
                                    </td>
                                    <td className="cert-id">{cert.certId}</td>
                                    <td>{cert.blockchainData?.studentName || cert.studentName || '—'}</td>
                                    <td>{cert.institution || '—'}</td>
                                    <td>{cert.blockchainData?.course || cert.course}</td>
                                    <td>{cert.blockchainData?.grade || cert.grade}</td>
                                    <td>{cert.issueDate ? new Date(cert.issueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
                                    <td>
                                        <span className={`status-badge ${cert.blockchainData?.isRevoked ? 'revoked' : 'valid'}`}>
                                            {cert.blockchainData?.isRevoked ? '❌ Revoked' : '✅ Valid'}
                                        </span>
                                    </td>
                                    <td className="actions">
                                        <button className="action-btn view" onClick={() => goToPublicVerify(cert.certId)}>👁️</button>
                                        {!cert.blockchainData?.isRevoked && (
                                            <button className="action-btn revoke" onClick={() => handleRevoke(cert.certId)} disabled={actionLoading[cert.certId]}>
                                                {actionLoading[cert.certId] === 'revoking' ? '...' : '🚫'}
                                            </button>
                                        )}
                                        <button className="action-btn delete" onClick={() => handleDelete(cert.certId)} disabled={actionLoading[cert.certId]}>
                                            {actionLoading[cert.certId] === 'deleting' ? '...' : '🗑️'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
                    )}
        </div>
    );
}

// ============================================
// MAIN APP COMPONENT
// ============================================

function MainApp() {
    const location = useLocation();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState(location.state?.activeTab || 'issue');
    const [activeModal, setActiveModal] = useState(null);
    const [walletState, setWalletState] = useState(null);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [issuanceFee, setIssuanceFee] = useState(null);
    useTheme();

    // Protection: Only allow authenticated admins
    useEffect(() => {
        const token = localStorage.getItem('adminToken');
        if (!token) {
            navigate('/login');
        }
    }, [navigate]);

    // Initial check for connected wallet
    useEffect(() => {
        const initWallet = async () => {
            const wallet = await getConnectedWallet();
            if (wallet) {
                setWalletState(wallet);
                // Check if authorized
                const authorized = await checkAuthorization(wallet.provider, wallet.address);
                setIsAuthorized(authorized);

                // Fetch issuance fee
                try {
                    const contract = new ethers.Contract(
                        CONTRACT_ADDRESS,
                        ["function issuanceFee() external view returns (uint256)"],
                        wallet.provider
                    );
                    const fee = await contract.issuanceFee();
                    setIssuanceFee(ethers.formatEther(fee));
                } catch (feeErr) {
                    console.error("Failed to fetch fee:", feeErr);
                }
            }
        };
        initWallet();

        // Listen for account/network changes
        if (window.ethereum) {
            window.ethereum.on('accountsChanged', (accounts) => {
                if (accounts.length === 0) {
                    setWalletState(null);
                    setIsAuthorized(false);
                } else {
                    initWallet();
                }
            });
            window.ethereum.on('chainChanged', () => {
                // Reload page as recommended by MetaMask
                window.location.reload();
            });
        }
    }, []);

    const renderModalContent = () => {
        switch (activeModal) {
            case 'privacy':
                return (
                    <LegalModal
                        title="Privacy Policy"
                        content={
                            <div className="legal-text">
                                <p><strong>Last Updated: January 2026</strong></p>
                                <p>SecureCert ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how your information is collected, used, and disclosed by SecureCert.</p>
                                <h4>1. Information We Collect</h4>
                                <p>We collect information you provide directly to us, such as student names, course details, and grades necessary for certificate issuance.</p>
                                <h4>2. Blockchain Data</h4>
                                <p>Please note that data stored on the blockchain is immutable and public. We hash personal data where possible, but certificate metadata is permanent.</p>
                                <h4>3. Contact Us</h4>
                                <p>If you have questions about this policy, please contact us at privacy@securecert.com.</p>
                            </div>
                        }
                        onClose={() => setActiveModal(null)}
                    />
                );
            case 'terms':
                return (
                    <LegalModal
                        title="Terms of Service"
                        content={
                            <div className="legal-text">
                                <p><strong>Effective Date: January 2026</strong></p>
                                <h4>1. Acceptance of Terms</h4>
                                <p>By accessing or using our services, you agree to be bound by these Terms. If you do not agree to these Terms, you may not access or use the Services.</p>
                                <h4>2. Immutable Records</h4>
                                <p>You acknowledge that certificates issued on the blockchain cannot be deleted or modified once confirmed. Revocations are recorded as new transactions.</p>
                                <h4>3. Limitation of Liability</h4>
                                <p>SecureCert shall not be liable for any indirect, incidental, special, consequential, or punitive damages.</p>
                            </div>
                        }
                        onClose={() => setActiveModal(null)}
                    />
                );
            case 'support':
                return (
                    <LegalModal
                        title="Contact Support"
                        content={
                            <div className="support-channels">
                                <div className="channel-item">
                                    <span className="channel-icon">📧</span>
                                    <div>
                                        <strong>Email Support</strong>
                                        <p>support@securecert.com</p>
                                    </div>
                                </div>
                                <div className="channel-item">
                                    <span className="channel-icon">📞</span>
                                    <div>
                                        <strong>Phone Support</strong>
                                        <p>+1 (555) 123-4567 (Mon-Fri, 9am-5pm EST)</p>
                                    </div>
                                </div>
                                <div className="channel-item">
                                    <span className="channel-icon">🐦</span>
                                    <div>
                                        <strong>Twitter / X</strong>
                                        <p>@SecureCertSupport</p>
                                    </div>
                                </div>
                            </div>
                        }
                        onClose={() => setActiveModal(null)}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div className="app-layout">
            {/* Animated Aurora Background */}
            <div className="aurora-bg">
                <div className="aurora-1"></div>
                <div className="aurora-2"></div>
                <div className="aurora-3"></div>
            </div>

            {/* Mobile Nav Toggle */}
            <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                {isSidebarOpen ? '✕' : '☰'}
            </button>

            {/* Sidebar Navigation */}
            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <h1 className="logo-text">Secure<span className="glow-text">Cert</span></h1>
                </div>

                <nav className="sidebar-nav">
                    <button className={`nav-item ${activeTab === 'issue' ? 'active' : ''}`} onClick={() => { setActiveTab('issue'); setIsSidebarOpen(false); }}>
                        <span className="nav-icon">✨</span> Issue Credential
                    </button>
                    <button className={`nav-item ${activeTab === 'verify' ? 'active' : ''}`} onClick={() => { setActiveTab('verify'); setIsSidebarOpen(false); }}>
                        <span className="nav-icon">🔍</span> Verify Record
                    </button>
                    <button className={`nav-item ${activeTab === 'admin' ? 'active' : ''}`} onClick={() => { setActiveTab('admin'); setIsSidebarOpen(false); }}>
                        <span className="nav-icon">📊</span> Admin System
                    </button>
                </nav>

                <div className="sidebar-footer">
                    <div className="onchain-status">
                        <span className="status-dot pulse"></span>
                        Blockchain Network Live
                    </div>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="main-content">
                {/* Topbar for Wallet */}
                <header className="topbar">
                    <div className="topbar-left">
                        <h2 className="current-page-title">
                            {activeTab === 'issue' && 'Issue New Credential'}
                            {activeTab === 'verify' && 'Verify Academic Record'}
                            {activeTab === 'admin' && 'Admin Control Center'}
                        </h2>
                    </div>
                    <div className="topbar-right">

                        <WalletButton walletState={walletState} setWalletState={setWalletState} isAuthorized={isAuthorized} />
                    </div>
                </header>

                {/* Content Views */}
                <div className="content-container">
                    {activeTab === 'issue' && <IssueForm walletState={walletState} isAuthorized={isAuthorized} issuanceFee={issuanceFee} />}
                    {activeTab === 'verify' && <VerifyForm />}
                    {activeTab === 'admin' && <AdminDashboard walletState={walletState} isAuthorized={isAuthorized} />}
                </div>

                <footer className="bento-footer">
                    <p>&copy; {new Date().getFullYear()} SecureCert Systems</p>
                    <div className="footer-links">
                        <button className="footer-link-btn" onClick={() => setActiveModal('privacy')}>Privacy</button>
                        <button className="footer-link-btn" onClick={() => setActiveModal('terms')}>Terms</button>
                        <button className="footer-link-btn" onClick={() => setActiveModal('support')}>Support</button>
                    </div>
                </footer>
            </main>

            {renderModalContent()}
        </div>
    );
}

// ============================================
// LANDING PAGE COMPONENT
// ============================================

function LandingPage() {
    const navigate = useNavigate();
    const [searchId, setSearchId] = useState('');

    const handleSearch = (e) => {
        e.preventDefault();
        if (searchId.trim()) {
            navigate(`/verify/${searchId.trim()}`);
        }
    };

    return (
        <div className="landing-page">
            <div className="landing-bg">
                <div className="landing-blob blob-1"></div>
                <div className="landing-blob blob-2"></div>
                <div className="landing-blob blob-3"></div>
            </div>

            <nav className="landing-nav">
                <div className="landing-logo">
                    <span className="logo-icon">✨</span>
                    <span className="logo-text">SecureCert</span>
                </div>
                <button className="nav-login-btn" onClick={() => navigate('/login')}>
                    Admin Portal
                </button>
            </nav>

            <main className="landing-hero">
                <div className="hero-content">
                    <div className="hero-badge">Next-Gen Credentialing</div>
                    <h1 className="hero-title">
                        Immutable Trust for <br />
                        <span className="gradient-text">Academic Excellence</span>
                    </h1>
                    <p className="hero-description">
                        Blockchain-powered certificate issuance and instant verification. 
                        Eliminate credential fraud with decentralized technology.
                    </p>

                    <div className="hero-actions">
                        <form onSubmit={handleSearch} className="landing-search-form">
                            <input 
                                type="text" 
                                placeholder="Enter Certificate ID to verify..." 
                                value={searchId}
                                onChange={(e) => setSearchId(e.target.value)}
                                className="landing-search-input"
                            />
                            <button type="submit" className="landing-search-btn">
                                Verify Now
                            </button>
                        </form>
                    </div>

                    <div className="hero-stats">
                        <div className="stat-item">
                            <span className="stat-val">100%</span>
                            <span className="stat-lab">Tamper-Proof</span>
                        </div>
                        <div className="stat-separator"></div>
                        <div className="stat-item">
                            <span className="stat-val">Instant</span>
                            <span className="stat-lab">Verification</span>
                        </div>
                        <div className="stat-separator"></div>
                        <div className="stat-item">
                            <span className="stat-val">Secure</span>
                            <span className="stat-lab">Storage</span>
                        </div>
                    </div>
                </div>

                <div className="hero-visual">
                    <div className="visual-card">
                        <div className="card-header">
                            <div className="card-dot"></div>
                            <div className="card-dot"></div>
                            <div className="card-dot"></div>
                        </div>
                        <div className="card-body">
                            <div className="visual-cert">
                                <div className="cert-line long"></div>
                                <div className="cert-line med"></div>
                                <div className="cert-line short"></div>
                                <div className="cert-seal">💠</div>
                            </div>
                            <div className="visual-status">
                                <span className="status-dot"></span>
                                Verified on Ethereum
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <footer className="landing-footer">
                <p>&copy; 2026 SecureCert Decentralized Registry. All rights reserved.</p>
            </footer>
        </div>
    );
}

// ============================================
// AUTH PAGE COMPONENT
// ============================================

function AuthPage() {
    const [adminUsername, setAdminUsername] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);
    const navigate = useNavigate();

    const handleAdminLogin = async (e) => {
        e.preventDefault();
        setLoginLoading(true);
        setLoginError('');

        try {
            const response = await axios.post(`${API_URL}/auth/login`, {
                username: adminUsername,
                password: adminPassword
            });

            const { token } = response.data;
            localStorage.setItem('adminToken', token);
            navigate('/dashboard', { state: { activeTab: 'admin' } });
        } catch (error) {
            setLoginError(error.response?.data?.error || 'Login failed');
        } finally {
            setLoginLoading(false);
        }
    };

    return (
        <div className="auth-page-container">
            <div className="auth-bg-animation">
                <div className="auth-blob blob-1"></div>
                <div className="auth-blob blob-2"></div>
                <div className="auth-blob blob-3"></div>
            </div>

            <div className="auth-card">
                <div className="auth-header">
                    <div className="auth-logo-icon">✨</div>
                    <h2>Admin Portal</h2>
                    <p>Secure access to credential management</p>
                </div>

                <form onSubmit={handleAdminLogin} className="auth-form">
                    <div className="auth-input-group">
                        <label>Username</label>
                        <div className="auth-input-wrapper">
                            <span className="auth-input-icon">👤</span>
                            <input
                                type="text"
                                placeholder="Enter admin username"
                                value={adminUsername}
                                onChange={(e) => setAdminUsername(e.target.value)}
                                required
                            />
                        </div>
                    </div>
                    <div className="auth-input-group">
                        <label>Password</label>
                        <div className="auth-input-wrapper">
                            <span className="auth-input-icon">🔒</span>
                            <input
                                type="password"
                                placeholder="Enter secure password"
                                value={adminPassword}
                                onChange={(e) => setAdminPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    {loginError && <div className="auth-error-msg">❌ {loginError}</div>}

                    <button type="submit" className="auth-submit-btn" disabled={loginLoading}>
                        {loginLoading ? 'Authenticating...' : 'Secure Login'}
                    </button>

                    <button type="button" className="auth-back-btn" onClick={() => navigate(localStorage.getItem('adminToken') ? '/dashboard' : '/')}>
                        ← Back to {localStorage.getItem('adminToken') ? 'Dashboard' : 'Public Portal'}
                    </button>
                </form>
            </div>
        </div>
    );
}

// ============================================
// APP WITH ROUTER
// ============================================

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/dashboard" element={<MainApp />} />
                <Route path="/login" element={<AuthPage />} />
                <Route path="/verify/:certId" element={<PublicVerifyPage />} />
            </Routes>
        </Router>
    );
}

export default App;