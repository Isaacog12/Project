import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL;

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
                    <div className="error-icon-pulse"></div>
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

    const handleDownloadPDF = async () => {
        setDownloadLoading(prev => ({ ...prev, pdf: true }));
        try {
            const response = await axios.get(`${API_URL}/certificates/${certId}/pdf`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `${certId}_certificate.pdf`);
            document.body.appendChild(link);
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
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `stamped_${certId}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            alert('Failed to download document');
        } finally {
            setDownloadLoading(prev => ({ ...prev, doc: false }));
        }
    };

    return (
        <div className="App">
            <header>
                <div className="hero-section">
                    <div className="hero-badge">✨ Blockchain Verified Credentials</div>
                    <h1 className="hero-title">Veritas <span className="gradient-text">Secure</span></h1>
                    <p className="hero-subtitle">The gold standard in decentralized academic verification. Immutable, instant, and globally recognized.</p>
                </div>
            </header>

            <div className="container">
                <div className="section">
                    <div className="verify-header">
                        <h2>Certificate ID: <span className="cert-id-display">{certId}</span></h2>
                        <Link to="/" className="back-link">← Back to Home</Link>
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
                                <Link to="/" className="home-btn">← Back to Home</Link>
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
                                            <span className="value">{new Date(result.issueDate * 1000).toLocaleDateString('en-US', {
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric'
                                            })}</span>
                                        </div>
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
                                    <button className="download-btn primary" onClick={handleDownloadPDF} disabled={downloadLoading.pdf}>
                                        {downloadLoading.pdf ? '⏳ Generating...' : '📜 Download Certificate PDF'}
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

function IssueForm() {
    const [studentName, setStudentName] = useState('');
    const [course, setCourse] = useState('');
    const [grade, setGrade] = useState('');
    const [document, setDocument] = useState(null);
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

            const response = await axios.post(`${API_URL}/certificates/issue`, formData);

            setIssueResult(response.data);
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

    const goToPublicVerify = (id) => {
        navigate(`/verify/${id}`);
    };

    return (
        <div className="section">
            <h2>Issue New Certificate</h2>
            <form onSubmit={handleIssue}>
                <div className="form-group">
                    <div className="input-wrapper">
                        <span className="input-icon-span">👤</span>
                        <input type="text" placeholder="Student Name" value={studentName} onChange={(e) => setStudentName(e.target.value)} required />
                    </div>
                </div>
                <div className="form-group">
                    <div className="input-wrapper">
                        <span className="input-icon-span">🎓</span>
                        <input type="text" placeholder="Department" value={course} onChange={(e) => setCourse(e.target.value)} required />
                    </div>
                </div>
                <div className="grade-input-group">
                    <div className="input-wrapper">
                        <span className="input-icon-span">📊</span>
                        <input
                            type="number"
                            placeholder="CGPA Score (0.00 - 5.00)"
                            step="0.01"
                            min="0"
                            max="5"
                            value={grade}
                            onChange={(e) => setGrade(e.target.value)}
                            required
                        />
                    </div>
                    {classInfo && (
                        <div className="grade-preview" style={{ borderColor: classInfo.color }}>
                            <span className="preview-icon">{classInfo.icon}</span>
                            <div className="preview-content">
                                <span className="preview-label">Degree Class</span>
                                <span className="preview-value" style={{ color: classInfo.color }}>{classInfo.label}</span>
                            </div>
                        </div>
                    )}
                </div>
                <div className="file-upload">
                    <label htmlFor="document-input" className="file-label">
                        📄 {document ? document.name : 'Attach Document (PDF)'}
                    </label>
                    <input id="document-input" type="file" accept=".pdf" onChange={(e) => setDocument(e.target.files[0])} className="file-input" />
                </div>
                <button type="submit" disabled={issueLoading}>
                    {issueLoading ? 'Issuing...' : 'Issue Certificate'}
                </button>
            </form>

            {issueResult && (
                <div className={`result ${issueResult.error ? 'error' : 'success'}`}>
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
                    ) : (
                        <div className="issue-success">
                            <div className="success-header">
                                <div className="big-icon">✅</div>
                                <h3>Certificate Issued Successfully!</h3>
                            </div>

                            <div className="issue-details">
                                <div className="detail-row">
                                    <label>Certificate ID</label>
                                    <span className="cert-id-value">{issueResult.certId}</span>
                                </div>

                                {issueResult.qrCode && (
                                    <div className="qr-section">
                                        <img src={issueResult.qrCode} alt="QR Code" className="qr-code" />
                                        <p className="qr-label">Scan to verify</p>
                                    </div>
                                )}

                                <div className="issue-actions">
                                    <button className="action-link" onClick={() => goToPublicVerify(issueResult.certId)}>
                                        🔗 Open Verification Page
                                    </button>
                                    <button className="action-link secondary" onClick={() => {
                                        navigator.clipboard.writeText(issueResult.verifyUrl || `${window.location.origin}/verify/${issueResult.certId}`);
                                        alert('Link copied!');
                                    }}>
                                        📋 Copy Link
                                    </button>
                                </div>
                            </div>

                            {issueResult.hasDocument && <p className="note">📄 Document attached and stored</p>}
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

function VerifyForm() {
    const [certId, setCertId] = useState('');
    const [verifyResult, setVerifyResult] = useState(null);
    const [verifyLoading, setVerifyLoading] = useState(false);
    const [downloadLoading, setDownloadLoading] = useState({ doc: false, pdf: false });
    const navigate = useNavigate();

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
        <div className="section">
            <h2>Verify Certificate</h2>
            <form onSubmit={handleVerify}>
                <div className="input-wrapper">
                    <span className="input-icon-span">🆔</span>
                    <input type="text" placeholder="Enter Certificate ID (e.g. CERT-123...)" value={certId} onChange={(e) => setCertId(e.target.value)} required />
                </div>
                <button type="submit" disabled={verifyLoading}>
                    {verifyLoading ? 'Verifying...' : 'Verify Certificate'}
                </button>
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
                            <p><strong>Course:</strong> {verifyResult.course}</p>
                            <p><strong>Grade:</strong> {verifyResult.grade}</p>
                            <p><strong>Issue Date:</strong> {new Date(verifyResult.issueDate * 1000).toLocaleDateString()}</p>

                            {verifyResult.qrCode && (
                                <div className="qr-section inline">
                                    <img src={verifyResult.qrCode} alt="QR Code" className="qr-code small" />
                                </div>
                            )}

                            <div className="download-actions">
                                <button className="download-btn" onClick={handleDownloadPDF} disabled={downloadLoading.pdf}>
                                    {downloadLoading.pdf ? '⏳ Generating...' : '📜 Download Certificate PDF'}
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

function AdminDashboard() {
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminToken, setAdminToken] = useState(localStorage.getItem('adminToken'));
    const [adminUsername, setAdminUsername] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);
    const [certificates, setCertificates] = useState([]);
    const [adminLoading, setAdminLoading] = useState(false);
    const [stats, setStats] = useState(null);
    const [actionLoading, setActionLoading] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const navigate = useNavigate();

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
        }
    }, [adminToken, loadAdminData]);

    useEffect(() => {
        if (adminToken) {
            verifyToken();
        }
    }, [adminToken, verifyToken]);

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
            setAdminToken(token);
            setIsAdmin(true);
            setAdminUsername('');
            setAdminPassword('');
            loadAdminData(token);
        } catch (error) {
            setLoginError(error.response?.data?.error || 'Login failed');
        } finally {
            setLoginLoading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('adminToken');
        setAdminToken(null);
        setIsAdmin(false);
        setCertificates([]);
        setStats(null);
    };

    const handleRevoke = React.useCallback(async (certId) => {
        if (!window.confirm(`Are you sure you want to revoke certificate ${certId}?`)) return;

        setActionLoading(prev => ({ ...prev, [certId]: 'revoking' }));
        try {
            await axios.post(`${API_URL}/admin/certificates/${certId}/revoke`, {}, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            alert('Certificate revoked successfully');
            loadAdminData();
        } catch (error) {
            alert(error.response?.data?.error || 'Failed to revoke certificate');
        } finally {
            setActionLoading(prev => ({ ...prev, [certId]: null }));
        }
    }, [adminToken, loadAdminData]);

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
            const certIdString = (cert.certId || '').toLowerCase();

            return studentName.includes(query) ||
                course.includes(query) ||
                grade.includes(query) ||
                certIdString.includes(query);
        });
    }, [certificates, searchQuery]);

    return (
        <div className="section">
            {!isAdmin ? (
                <>
                    <h2>🔐 Admin Login</h2>
                    <form onSubmit={handleAdminLogin}>
                        <div className="input-wrapper">
                            <span className="input-icon-span">🌪️</span>
                            <input type="text" placeholder="Admin Username" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} required />
                        </div>
                        <div className="input-wrapper">
                            <span className="input-icon-span">🔒</span>
                            <input type="password" placeholder="Secure Password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required />
                        </div>
                        <button type="submit" disabled={loginLoading}>
                            {loginLoading ? 'Logging in...' : 'Login'}
                        </button>
                    </form>
                    {loginError && <div className="result error"><p>❌ {loginError}</p></div>}
                </>
            ) : (
                <>
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
                                        <th>ID</th>
                                        <th>Student</th>
                                        <th>Course</th>
                                        <th>Grade</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredCertificates.map((cert) => (
                                        <tr key={cert.certId} className={cert.blockchainData?.isRevoked ? 'revoked-row' : ''}>
                                            <td className="cert-id">{cert.certId}</td>
                                            <td>{cert.blockchainData?.studentName || cert.studentName}</td>
                                            <td>{cert.blockchainData?.course || cert.course}</td>
                                            <td>{cert.blockchainData?.grade || cert.grade}</td>
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
                </>
            )}
        </div>
    );
}

// ============================================
// MAIN APP COMPONENT
// ============================================

function MainApp() {
    const [activeTab, setActiveTab] = useState('issue');
    const [activeModal, setActiveModal] = useState(null);

    const renderModalContent = () => {
        switch (activeModal) {
            case 'privacy':
                return (
                    <LegalModal
                        title="Privacy Policy"
                        content={
                            <div className="legal-text">
                                <p><strong>Last Updated: January 2026</strong></p>
                                <p>Veritas Secure ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how your information is collected, used, and disclosed by Veritas Secure.</p>
                                <h4>1. Information We Collect</h4>
                                <p>We collect information you provide directly to us, such as student names, course details, and grades necessary for certificate issuance.</p>
                                <h4>2. Blockchain Data</h4>
                                <p>Please note that data stored on the blockchain is immutable and public. We hash personal data where possible, but certificate metadata is permanent.</p>
                                <h4>3. Contact Us</h4>
                                <p>If you have questions about this policy, please contact us at privacy@veritas.com.</p>
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
                                <p>Veritas Secure shall not be liable for any indirect, incidental, special, consequential, or punitive damages.</p>
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
                                        <p>support@veritas.com</p>
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
                                        <p>@VeritasSupport</p>
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
        <div className="App">
            <header>
                <div className="hero-section">
                    <div className="hero-badge">✨ Blockchain Verified Credentials</div>
                    <h1 className="hero-title">Veritas <span className="gradient-text">Secure</span></h1>
                    <p className="hero-subtitle">The gold standard in decentralized academic verification. Immutable, instant, and globally recognized.</p>
                </div>
            </header>

            <div className="tabs">
                <button className={activeTab === 'issue' ? 'active' : ''} onClick={() => setActiveTab('issue')}>
                    Issue Certificate
                </button>
                <button className={activeTab === 'verify' ? 'active' : ''} onClick={() => setActiveTab('verify')}>
                    Verify Certificate
                </button>
                <button className={activeTab === 'admin' ? 'active' : ''} onClick={() => setActiveTab('admin')}>
                    🔐 Admin
                </button>
            </div>

            <div className="container">
                {activeTab === 'issue' && <IssueForm />}
                {activeTab === 'verify' && <VerifyForm />}
                {activeTab === 'admin' && <AdminDashboard />}
            </div>

            <div className="how-it-works">
                <h3>How It Works</h3>
                <div className="steps-grid">
                    <div className="step-card">
                        <span className="step-icon">📝</span>
                        <h4>1. Issue</h4>
                        <p>Institution issues a digital certificate. The data is hashed and stored permanently on the blockchain.</p>
                    </div>
                    <div className="step-card">
                        <span className="step-icon">🔗</span>
                        <h4>2. Secure</h4>
                        <p>The student receives a tamper-proof certificate ID and QR code linked to the blockchain record.</p>
                    </div>
                    <div className="step-card">
                        <span className="step-icon">✅</span>
                        <h4>3. Verify</h4>
                        <p>Employers or anyone can instantly verify the authenticity by scanning the QR code or entering the ID.</p>
                    </div>
                </div>
            </div>

            <footer className="app-footer">
                <div className="footer-content">
                    <p>&copy; {new Date().getFullYear()} Veritas Secure System. All rights reserved.</p>
                    <div className="footer-links">
                        <button className="footer-link-btn" onClick={() => setActiveModal('privacy')}>Privacy Policy</button>
                        <button className="footer-link-btn" onClick={() => setActiveModal('terms')}>Terms of Service</button>
                        <button className="footer-link-btn" onClick={() => setActiveModal('support')}>Contact Support</button>
                    </div>
                </div>
            </footer>
            {renderModalContent()}
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
                <Route path="/" element={<MainApp />} />
                <Route path="/verify/:certId" element={<PublicVerifyPage />} />
            </Routes>
        </Router>
    );
}

export default App;