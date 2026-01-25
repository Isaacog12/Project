require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const { ethers } = require('ethers');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');

// ============================================
// ENVIRONMENT VALIDATION
// ============================================

const requiredEnvVars = [
    'PORT',
    'CONTRACT_ADDRESS',
    'RPC_URL',
    'PRIVATE_KEY',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'JWT_SECRET',
    'FRONTEND_URL'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('\nPlease check your .env file and ensure all required variables are set.');
    process.exit(1);
}

console.log('✅ Environment variables validated');

// ============================================
// EXPRESS APP SETUP
// ============================================

const app = express();

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// CORS
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // Limit login attempts
    message: 'Too many login attempts, please try again later.',
    skipSuccessfulRequests: true,
});

app.use('/api/', limiter);

// Request logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// ============================================
// DATABASE SETUP (SQLite)
// ============================================

const dbPath = path.join(__dirname, 'certificates.db');
const db = new Database(dbPath);

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS certificates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        certId TEXT UNIQUE NOT NULL,
        studentName TEXT NOT NULL,
        course TEXT NOT NULL,
        grade TEXT NOT NULL,
        issueDate TEXT NOT NULL,
        txHash TEXT,
        documentPath TEXT,
        documentOriginalName TEXT,
        notes TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_certId ON certificates(certId);
`);

console.log('Database initialized at:', dbPath);

// ============================================
// MULTER SETUP
// ============================================

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `temp_${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, PNG, and JPEG files are allowed'));
        }
    }
});

// ============================================
// BLOCKCHAIN SETUP
// ============================================

const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL,
    {
        name: 'sepolia',
        chainId: 11155111
    },
    {
        staticNetwork: true,
        timeout: 30000 // 30 seconds timeout
    }
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const CONTRACT_ABI = [
    "function issueCertificate(string certId, string studentName, string course, string grade) external",
    "function verifyCertificate(string certId) external view returns (string studentName, string course, string grade, uint256 issueDate, bool isRevoked)",
    "function revokeCertificate(string certId) external"
];

const contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    CONTRACT_ABI,
    wallet
);

// ============================================
// HELPER FUNCTIONS
// ============================================

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Generate QR Code as base64 data URL
async function generateQRCode(certId) {
    const verifyUrl = `${FRONTEND_URL}/verify/${certId}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#1a365d', light: '#ffffff' }
    });
    return qrDataUrl;
}

// Generate Certificate PDF - Enhanced Award Style
async function generateCertificatePDF(certData, qrCodeDataUrl) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([842, 595]); // A4 Landscape

    const { width, height } = page.getSize();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

    // Veritas green color
    const veritasGreen = rgb(0.04, 0.29, 0.20);
    const goldColor = rgb(0.72, 0.53, 0.04);
    const darkGray = rgb(0.2, 0.2, 0.2);

    // Randomly select logo (1 or 2)
    const logoNumber = Math.random() < 0.5 ? 1 : 2;
    const logoPath = path.join(__dirname, 'assets', `logo${logoNumber}.jpg`);

    // Add subtle logo watermark as background
    try {
        const logoBytes = fs.readFileSync(logoPath);
        const logoImage = await pdfDoc.embedJpg(logoBytes);
        const logoAspectRatio = logoImage.width / logoImage.height;
        const targetHeight = height * 0.5;
        const targetWidth = targetHeight * logoAspectRatio;

        page.drawImage(logoImage, {
            x: width / 2 - targetWidth / 2,
            y: height / 2 - targetHeight / 2,
            width: targetWidth,
            height: targetHeight,
            opacity: 0.03,
        });
    } catch (error) {
        console.error('Error loading logo watermark:', error.message);
    }

    // === DECORATIVE BORDER SYSTEM ===
    const margin = 30;
    const innerMargin = 45;

    // Outer border (gold/bronze)
    page.drawRectangle({
        x: margin,
        y: margin,
        width: width - (margin * 2),
        height: height - (margin * 2),
        borderColor: goldColor,
        borderWidth: 3,
    });

    // Inner border (dark green)
    page.drawRectangle({
        x: innerMargin,
        y: innerMargin,
        width: width - (innerMargin * 2),
        height: height - (innerMargin * 2),
        borderColor: veritasGreen,
        borderWidth: 2,
    });

    // Corner ornaments (decorative squares)
    const ornamentSize = 15;
    const ornamentOffset = 38;
    const corners = [
        { x: ornamentOffset, y: height - ornamentOffset }, // Top-left
        { x: width - ornamentOffset - ornamentSize, y: height - ornamentOffset }, // Top-right
        { x: ornamentOffset, y: ornamentOffset }, // Bottom-left
        { x: width - ornamentOffset - ornamentSize, y: ornamentOffset }, // Bottom-right
    ];

    corners.forEach(corner => {
        // Outer square (gold)
        page.drawRectangle({
            x: corner.x,
            y: corner.y,
            width: ornamentSize,
            height: ornamentSize,
            color: goldColor,
        });
        // Inner square (green)
        page.drawRectangle({
            x: corner.x + 3,
            y: corner.y - 3,
            width: ornamentSize - 6,
            height: ornamentSize - 6,
            color: veritasGreen,
        });
    });

    // === HEADER SECTION ===
    // University logo at top center
    try {
        const logoBytes = fs.readFileSync(logoPath);
        const logoImage = await pdfDoc.embedJpg(logoBytes);
        const logoAspectRatio = logoImage.width / logoImage.height;
        const logoHeight = 60;
        const logoWidth = logoHeight * logoAspectRatio;

        page.drawImage(logoImage, {
            x: width / 2 - logoWidth / 2,
            y: height - 110,
            width: logoWidth,
            height: logoHeight,
        });
    } catch (error) {
        console.error('Error adding header logo:', error.message);
    }

    // University name
    const universityText = 'Veritas University Abuja';
    const universitySize = 20;
    const universityWidth = timesBold.widthOfTextAtSize(universityText, universitySize);
    page.drawText(universityText, {
        x: width / 2 - universityWidth / 2,
        y: height - 135,
        size: universitySize,
        font: timesBold,
        color: veritasGreen,
    });

    // Decorative line under university name
    page.drawLine({
        start: { x: width / 2 - 100, y: height - 145 },
        end: { x: width / 2 + 100, y: height - 145 },
        thickness: 1,
        color: goldColor,
    });

    // === AWARD TITLE ===
    const titleText = 'AWARD OF EXCELLENCE';
    const titleSize = 32;
    const titleWidth = timesBold.widthOfTextAtSize(titleText, titleSize);
    page.drawText(titleText, {
        x: width / 2 - titleWidth / 2,
        y: height - 200,
        size: titleSize,
        font: timesBold,
        color: veritasGreen,
    });

    // Decorative lines around title
    const titleLineY = height - 210;
    page.drawLine({
        start: { x: width / 2 - titleWidth / 2 - 30, y: titleLineY },
        end: { x: width / 2 - titleWidth / 2 - 10, y: titleLineY },
        thickness: 2,
        color: goldColor,
    });
    page.drawLine({
        start: { x: width / 2 + titleWidth / 2 + 10, y: titleLineY },
        end: { x: width / 2 + titleWidth / 2 + 30, y: titleLineY },
        thickness: 2,
        color: goldColor,
    });

    // === BODY TEXT ===
    // "This is to certify that"
    const certifyText = 'This is to certify that';
    const certifySize = 14;
    const certifyWidth = timesItalic.widthOfTextAtSize(certifyText, certifySize);
    page.drawText(certifyText, {
        x: width / 2 - certifyWidth / 2,
        y: height - 250,
        size: certifySize,
        font: timesItalic,
        color: darkGray,
    });

    // Student Name (prominent)
    const studentName = certData.studentName.toUpperCase();
    const studentSize = 28;
    const studentWidth = timesBold.widthOfTextAtSize(studentName, studentSize);
    page.drawText(studentName, {
        x: width / 2 - studentWidth / 2,
        y: height - 290,
        size: studentSize,
        font: timesBold,
        color: rgb(0.5, 0.1, 0.1),
    });

    // Decorative underline for student name
    page.drawLine({
        start: { x: width / 2 - studentWidth / 2 - 20, y: height - 298 },
        end: { x: width / 2 + studentWidth / 2 + 20, y: height - 298 },
        thickness: 1.5,
        color: goldColor,
    });

    // Achievement text
    const achievementText = 'has successfully completed the requirements for';
    const achievementSize = 12;
    const achievementWidth = helvetica.widthOfTextAtSize(achievementText, achievementSize);
    page.drawText(achievementText, {
        x: width / 2 - achievementWidth / 2,
        y: height - 330,
        size: achievementSize,
        font: helvetica,
        color: darkGray,
    });

    // Course name
    const courseSize = 22;
    const courseWidth = timesBold.widthOfTextAtSize(certData.course, courseSize);
    page.drawText(certData.course, {
        x: width / 2 - courseWidth / 2,
        y: height - 365,
        size: courseSize,
        font: timesBold,
        color: veritasGreen,
    });

    // Grade display
    const gradeText = `with a grade of ${certData.grade}`;
    const gradeSize = 14;
    const gradeWidth = helveticaBold.widthOfTextAtSize(gradeText, gradeSize);
    page.drawText(gradeText, {
        x: width / 2 - gradeWidth / 2,
        y: height - 395,
        size: gradeSize,
        font: helveticaBold,
        color: rgb(0, 0.6, 0.3),
    });

    // === BOTTOM SECTION ===
    // Issue date
    const issueDate = new Date(certData.issueDate).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    const dateText = `Issued on ${issueDate}`;
    const dateSize = 11;
    const dateWidth = helvetica.widthOfTextAtSize(dateText, dateSize);
    page.drawText(dateText, {
        x: width / 2 - dateWidth / 2,
        y: 180,
        size: dateSize,
        font: helvetica,
        color: darkGray,
    });

    // === SIGNATURE SECTION ===
    const sigY = 130;

    // Signature line
    page.drawLine({
        start: { x: width / 2 - 120, y: sigY },
        end: { x: width / 2 + 120, y: sigY },
        thickness: 1,
        color: darkGray,
    });

    // Signature title
    const sigTitle = 'Registrar, Veritas University Abuja';
    const sigTitleSize = 10;
    const sigTitleWidth = helvetica.widthOfTextAtSize(sigTitle, sigTitleSize);
    page.drawText(sigTitle, {
        x: width / 2 - sigTitleWidth / 2,
        y: sigY - 15,
        size: sigTitleSize,
        font: helvetica,
        color: darkGray,
    });

    // === SEAL/BADGE (Left side) ===
    const sealX = 100;
    const sealY = 100;
    const sealRadius = 35;

    // Outer circle (gold)
    page.drawCircle({
        x: sealX,
        y: sealY,
        size: sealRadius,
        borderColor: goldColor,
        borderWidth: 3,
    });

    // Inner circle (green)
    page.drawCircle({
        x: sealX,
        y: sealY,
        size: sealRadius - 8,
        borderColor: veritasGreen,
        borderWidth: 2,
    });

    // Seal text
    page.drawText('OFFICIAL', {
        x: sealX - 20,
        y: sealY + 5,
        size: 8,
        font: helveticaBold,
        color: veritasGreen,
    });
    page.drawText('SEAL', {
        x: sealX - 12,
        y: sealY - 5,
        size: 8,
        font: helveticaBold,
        color: veritasGreen,
    });

    // === QR CODE (Right side) ===
    if (qrCodeDataUrl) {
        const qrImageBytes = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
        const qrImage = await pdfDoc.embedPng(qrImageBytes);
        page.drawImage(qrImage, {
            x: width - 140,
            y: 70,
            width: 70,
            height: 70
        });
        page.drawText('Scan to Verify', {
            x: width - 135,
            y: 60,
            size: 7,
            font: helvetica,
            color: darkGray
        });
    }

    // === BLOCKCHAIN INFO ===
    page.drawText('BLOCKCHAIN SECURED', {
        x: 60,
        y: 60,
        size: 8,
        font: helveticaBold,
        color: veritasGreen
    });

    // Certificate ID
    page.drawText(`Certificate No: ${certData.certId}`, {
        x: 60,
        y: 48,
        size: 7,
        font: helvetica,
        color: darkGray
    });

    if (certData.txHash) {
        page.drawText(`TX: ${certData.txHash.substring(0, 30)}...`, {
            x: 60,
            y: 38,
            size: 6,
            font: helvetica,
            color: rgb(0.6, 0.6, 0.6)
        });
    }

    return await pdfDoc.save();
}

// ============================================
// MIDDLEWARE
// ============================================

// Validation error handler
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(err => ({
                field: err.path,
                message: err.msg
            }))
        });
    }
    next();
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Global error handler
const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Multer errors
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }

    // Custom errors
    if (err.status) {
        return res.status(err.status).json({ error: err.message });
    }

    // Default error
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
};

// ============================================
// HEALTH CHECK ENDPOINTS
// ============================================

// Basic health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Detailed readiness check
app.get('/ready', async (req, res) => {
    try {
        // Check database
        const dbCheck = db.prepare('SELECT 1').get();

        // Check blockchain connection
        await provider.getBlockNumber();

        res.json({
            status: 'ready',
            checks: {
                database: 'connected',
                blockchain: 'connected',
                contract: process.env.CONTRACT_ADDRESS
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'not ready',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ============================================
// AUTH ENDPOINTS
// ============================================

app.post('/api/auth/login',
    authLimiter,
    [
        body('username').trim().notEmpty().withMessage('Username is required'),
        body('password').notEmpty().withMessage('Password is required')
    ],
    handleValidationErrors,
    (req, res) => {
        const { username, password } = req.body;

        if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
            const token = jwt.sign(
                { username, role: 'admin' },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            console.log(`✅ Admin login successful: ${username}`);
            res.json({
                success: true,
                token,
                user: { username, role: 'admin' }
            });
        } else {
            console.log(`❌ Failed login attempt for: ${username}`);
            res.status(401).json({ error: 'Invalid credentials' });
        }
    }
);

app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// ============================================
// PUBLIC ENDPOINTS
// ============================================

// Issue certificate with optional document
app.post('/api/certificates/issue',
    upload.single('document'),
    [
        body('studentName').trim().notEmpty().withMessage('Student name is required')
            .isLength({ min: 2, max: 100 }).withMessage('Student name must be 2-100 characters'),
        body('course').trim().notEmpty().withMessage('Course is required')
            .isLength({ min: 2, max: 100 }).withMessage('Course must be 2-100 characters'),
        body('grade').trim().notEmpty().withMessage('Grade is required')
            .isLength({ min: 1, max: 50 }).withMessage('Grade must be 1-50 characters')
    ],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const { studentName, course, grade } = req.body;
            const certId = `CERT${Date.now()}`;

            console.log(`📝 Issuing certificate for: ${studentName}`);

            // Issue on blockchain
            const tx = await contract.issueCertificate(certId, studentName, course, grade);
            await tx.wait();

            let documentPath = null;
            if (req.file) {
                const ext = path.extname(req.file.originalname);
                const newFilename = `${certId}${ext}`;
                const newPath = path.join(__dirname, 'uploads', newFilename);
                fs.renameSync(req.file.path, newPath);
                documentPath = newFilename;
            }

            // Generate QR Code
            const qrCode = await generateQRCode(certId);

            // Save to database
            const stmt = db.prepare(`
                INSERT INTO certificates (certId, studentName, course, grade, issueDate, txHash, documentPath, documentOriginalName)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(certId, studentName, course, grade, new Date().toISOString(), tx.hash, documentPath, req.file?.originalname || null);

            console.log(`✅ Certificate issued: ${certId}`);

            res.json({
                success: true,
                certId,
                txHash: tx.hash,
                hasDocument: !!documentPath,
                qrCode,
                verifyUrl: `${FRONTEND_URL}/verify/${certId}`,
                message: 'Certificate issued successfully'
            });
        } catch (error) {
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            console.error('❌ Issue error:', error);
            next(error);
        }
    }
);

// Verify certificate (public)
app.get('/api/certificates/verify/:certId', async (req, res) => {
    try {
        const { certId } = req.params;

        // Get from blockchain
        const result = await contract.verifyCertificate(certId);

        // Get from database
        const dbCert = db.prepare('SELECT * FROM certificates WHERE certId = ?').get(certId);

        // Generate QR code
        const qrCode = await generateQRCode(certId);

        res.json({
            exists: true,
            studentName: result[0],
            course: result[1],
            grade: result[2],
            issueDate: Number(result[3]),
            isRevoked: result[4],
            hasDocument: !!(dbCert?.documentPath),
            txHash: dbCert?.txHash || null,
            qrCode,
            verifyUrl: `${FRONTEND_URL}/verify/${certId}`
        });
    } catch (error) {
        if (error.message.includes("Certificate does not exist")) {
            res.json({ exists: false });
        } else {
            console.error('Verify error:', error);
            res.status(500).json({ error: error.message });
        }
    }
});

// Get QR Code for certificate
app.get('/api/certificates/:certId/qrcode', async (req, res) => {
    try {
        const { certId } = req.params;
        const qrCode = await generateQRCode(certId);
        res.json({ qrCode, verifyUrl: `${FRONTEND_URL}/verify/${certId}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Download certificate PDF
app.get('/api/certificates/:certId/pdf', async (req, res) => {
    try {
        const { certId } = req.params;

        // Verify on blockchain
        const result = await contract.verifyCertificate(certId);
        if (result[4]) {
            return res.status(400).json({ error: 'Certificate has been revoked' });
        }

        // Get from database
        const dbCert = db.prepare('SELECT * FROM certificates WHERE certId = ?').get(certId);

        const certData = {
            certId,
            studentName: result[0],
            course: result[1],
            grade: result[2],
            issueDate: new Date(Number(result[3]) * 1000),
            txHash: dbCert?.txHash
        };

        // Generate QR code and PDF
        const qrCode = await generateQRCode(certId);
        const pdfBytes = await generateCertificatePDF(certData, qrCode);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${certId}_certificate.pdf"`);
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        if (error.message.includes("Certificate does not exist")) {
            res.status(404).json({ error: 'Certificate not found' });
        } else {
            console.error('PDF generation error:', error);
            res.status(500).json({ error: error.message });
        }
    }
});

// Download stamped document
app.get('/api/certificates/download/:certId', async (req, res) => {
    try {
        const { certId } = req.params;
        const result = await contract.verifyCertificate(certId);

        if (result[4]) {
            return res.status(400).json({ error: 'Certificate has been revoked' });
        }

        const dbCert = db.prepare('SELECT * FROM certificates WHERE certId = ?').get(certId);
        if (!dbCert || !dbCert.documentPath) {
            return res.status(404).json({ error: 'No document found for this certificate' });
        }

        const filePath = path.join(__dirname, 'uploads', dbCert.documentPath);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Document file not found' });
        }

        const ext = path.extname(dbCert.documentPath).toLowerCase();

        if (ext === '.pdf') {
            const pdfBytes = fs.readFileSync(filePath);
            const pdfDoc = await PDFDocument.load(pdfBytes);
            const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
            const pages = pdfDoc.getPages();

            // Generate QR code
            const qrDataUrl = await generateQRCode(certId);
            const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
            const qrImage = await pdfDoc.embedPng(qrImageBytes);

            pages.forEach((page) => {
                const { width, height } = page.getSize();
                const stampText = `VERIFIED: ${certId}`;
                const fontSize = 12;
                const textWidth = helveticaBold.widthOfTextAtSize(stampText, fontSize);

                page.drawRectangle({
                    x: width / 2 - textWidth / 2 - 10,
                    y: 20,
                    width: textWidth + 20,
                    height: 25,
                    color: rgb(0.1, 0.3, 0.5),
                });

                page.drawText(stampText, {
                    x: width / 2 - textWidth / 2,
                    y: 27,
                    size: fontSize,
                    font: helveticaBold,
                    color: rgb(1, 1, 1),
                });

                // Add QR code to bottom right
                page.drawImage(qrImage, {
                    x: width - 80,
                    y: 15,
                    width: 60,
                    height: 60,
                });

                page.drawText(certId, {
                    x: width / 4,
                    y: height / 2,
                    size: 40,
                    font: helveticaBold,
                    color: rgb(0.8, 0.8, 0.8),
                    opacity: 0.3,
                    rotate: { type: 'degrees', angle: 45 },
                });
            });

            const stampedPdfBytes = await pdfDoc.save();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="stamped_${certId}.pdf"`);
            res.send(Buffer.from(stampedPdfBytes));
        } else {
            res.setHeader('Content-Disposition', `attachment; filename="${certId}${ext}"`);
            res.sendFile(filePath);
        }
    } catch (error) {
        if (error.message.includes("Certificate does not exist")) {
            res.status(404).json({ error: 'Certificate not found on blockchain' });
        } else {
            console.error('Download error:', error);
            res.status(500).json({ error: error.message });
        }
    }
});

// ============================================
// ADMIN PROTECTED ENDPOINTS
// ============================================

app.get('/api/admin/certificates', authenticateToken, async (req, res) => {
    try {
        const allCerts = db.prepare('SELECT * FROM certificates ORDER BY createdAt DESC').all();

        const enrichedCerts = await Promise.all(
            allCerts.map(async (cert) => {
                try {
                    const result = await contract.verifyCertificate(cert.certId);
                    return {
                        ...cert,
                        blockchainData: {
                            studentName: result[0],
                            course: result[1],
                            grade: result[2],
                            issueDate: Number(result[3]),
                            isRevoked: result[4]
                        }
                    };
                } catch (error) {
                    return { ...cert, blockchainData: null, error: 'Failed to fetch blockchain data' };
                }
            })
        );

        res.json(enrichedCerts);
    } catch (error) {
        console.error('Admin get certificates error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/certificates/:certId', authenticateToken, upload.single('document'), async (req, res) => {
    try {
        const { certId } = req.params;
        const dbCert = db.prepare('SELECT * FROM certificates WHERE certId = ?').get(certId);

        if (!dbCert) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        let updates = [];
        let params = [];

        if (req.body.notes !== undefined) {
            updates.push('notes = ?');
            params.push(req.body.notes);
        }

        if (req.file) {
            if (dbCert.documentPath) {
                const oldPath = path.join(__dirname, 'uploads', dbCert.documentPath);
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }

            const ext = path.extname(req.file.originalname);
            const newFilename = `${certId}${ext}`;
            const newPath = path.join(__dirname, 'uploads', newFilename);
            fs.renameSync(req.file.path, newPath);

            updates.push('documentPath = ?', 'documentOriginalName = ?');
            params.push(newFilename, req.file.originalname);
        }

        if (updates.length > 0) {
            params.push(certId);
            db.prepare(`UPDATE certificates SET ${updates.join(', ')} WHERE certId = ?`).run(...params);
        }

        const updatedCert = db.prepare('SELECT * FROM certificates WHERE certId = ?').get(certId);

        res.json({
            success: true,
            message: 'Certificate updated successfully',
            certificate: updatedCert
        });
    } catch (error) {
        console.error('Update certificate error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/certificates/:certId/revoke', authenticateToken, async (req, res) => {
    try {
        const { certId } = req.params;
        await contract.verifyCertificate(certId);

        const tx = await contract.revokeCertificate(certId);
        await tx.wait();

        res.json({
            success: true,
            message: 'Certificate revoked successfully',
            txHash: tx.hash
        });
    } catch (error) {
        if (error.message.includes("Certificate does not exist")) {
            res.status(404).json({ error: 'Certificate not found on blockchain' });
        } else if (error.message.includes("Already revoked")) {
            res.status(400).json({ error: 'Certificate is already revoked' });
        } else {
            console.error('Revoke certificate error:', error);
            res.status(500).json({ error: error.message });
        }
    }
});

app.delete('/api/admin/certificates/:certId', authenticateToken, async (req, res) => {
    try {
        const { certId } = req.params;
        const dbCert = db.prepare('SELECT * FROM certificates WHERE certId = ?').get(certId);

        if (!dbCert) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        if (dbCert.documentPath) {
            const filePath = path.join(__dirname, 'uploads', dbCert.documentPath);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        db.prepare('DELETE FROM certificates WHERE certId = ?').run(certId);

        res.json({
            success: true,
            message: 'Certificate deleted from database. Note: Blockchain record is permanent.'
        });
    } catch (error) {
        console.error('Delete certificate error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/stats', authenticateToken, async (req, res) => {
    try {
        const allCerts = db.prepare('SELECT * FROM certificates').all();
        let revokedCount = 0;
        let validCount = 0;

        for (const cert of allCerts) {
            try {
                const result = await contract.verifyCertificate(cert.certId);
                if (result[4]) {
                    revokedCount++;
                } else {
                    validCount++;
                }
            } catch (error) {
                // Skip if not found on blockchain
            }
        }

        res.json({
            totalCertificates: allCerts.length,
            validCertificates: validCount,
            revokedCertificates: revokedCount,
            documentsUploaded: allCerts.filter(c => c.documentPath).length
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Legacy endpoint
app.get('/api/certificates', (req, res) => {
    const certs = db.prepare('SELECT * FROM certificates ORDER BY createdAt DESC').all();
    res.json(certs);
});

// Apply error handler (must be last)
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Certificate Verification Server Started');
    console.log('='.repeat(50));
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`🌐 Frontend: ${process.env.FRONTEND_URL}`);
    console.log(`⛓️  Blockchain: ${process.env.RPC_URL}`);
    console.log(`📜 Contract: ${process.env.CONTRACT_ADDRESS}`);
    console.log(`💾 Database: ${dbPath}`);
    console.log('='.repeat(50) + '\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n⚠️  SIGTERM received, shutting down backend...');
    db.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n⚠️  Signal received, shutting down backend...');
    db.close();
    process.exit(0);
});
