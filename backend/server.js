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
const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const Database = require('better-sqlite3');


const QRCode = require('qrcode');
const csv = require('csv-parser');
const axios = require('axios');
const FormData = require('form-data');

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
console.log('DEBUG: DATABASE_URL is', process.env.DATABASE_URL);

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
// DATABASE SETUP (Prisma)
// ============================================

const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const db = new Database(dbUrl.replace('file:', ''));
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });
console.log('Prisma Client initialized with better-sqlite3 adapter');

/**
 * Pins a file buffer to the global IPFS network using the Pinata gateway.
 */
async function pinToIPFS(pdfBuffer, certId) {
    const pinataApiKey = process.env.PINATA_API_KEY;
    const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;

    if (!pinataApiKey || !pinataSecretApiKey) {
        console.error('❌ Pinata API keys are missing. IPFS pinning disabled.');
        throw new Error('IPFS configuration missing. Please set PINATA_API_KEY and PINATA_SECRET_API_KEY.');
    }

    try {
        const url = `https://api.pinata.cloud/pinning/pinFileToIPFS`;
        let data = new FormData();
        data.append('file', pdfBuffer, {
            filename: `${certId}.pdf`,
            contentType: 'application/pdf',
        });

        const response = await axios.post(url, data, {
            maxBodyLength: 'Infinity',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${data._boundary}`,
                'pinata_api_key': pinataApiKey,
                'pinata_secret_api_key': pinataSecretApiKey
            }
        });

        console.log(`📌 Pinned ${certId} to IPFS: ${response.data.IpfsHash}`);
        return response.data.IpfsHash;
    } catch (error) {
        console.error('❌ IPFS pinning failed:', error.response?.data || error.message);
        return null;
    }
}

/**
 * Pins JSON metadata to IPFS.
 */
async function pinJSONToIPFS(metadata, certId) {
    const pinataApiKey = process.env.PINATA_API_KEY;
    const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;

    if (!pinataApiKey || !pinataSecretApiKey) {
        console.error('❌ Pinata API keys are missing. IPFS JSON pinning disabled.');
        throw new Error('IPFS configuration missing. Please set PINATA_API_KEY and PINATA_SECRET_API_KEY.');
    }

    try {
        const url = `https://api.pinata.cloud/pinning/pinJSONToIPFS`;
        const response = await axios.post(url, {
            pinataContent: metadata,
            pinataMetadata: {
                name: `${certId}_metadata.json`
            }
        }, {
            headers: {
                'pinata_api_key': pinataApiKey,
                'pinata_secret_api_key': pinataSecretApiKey
            }
        });

        console.log(`📌 Pinned ${certId} metadata to IPFS: ${response.data.IpfsHash}`);
        return response.data.IpfsHash;
    } catch (error) {
        console.error('❌ IPFS JSON pinning failed:', error.response?.data || error.message);
        return null;
    }
}

/**
 * Fetches metadata JSON from IPFS.
 */
async function fetchFromIPFS(cid) {
    if (cid.startsWith('mock-')) return null;
    try {
        const url = `https://gateway.pinata.cloud/ipfs/${cid}`;
        const response = await axios.get(url, { timeout: 5000 });
        return response.data;
    } catch (error) {
        console.error(`❌ Failed to fetch from IPFS (${cid}):`, error.message);
        return null;
    }
}

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

const fetchReq = new ethers.FetchRequest(process.env.RPC_URL);
fetchReq.timeout = 120000; // 120 seconds timeout to handle slow blockchain responses

const provider = new ethers.JsonRpcProvider(
    fetchReq,
    undefined, // Auto-detect network
    {
        staticNetwork: true
    }
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const CONTRACT_ABI = [
    "function issueCertificate(string certId, string metadataCID) external payable",
    "function batchIssueCertificates(string[] certIds, string[] metadataCIDs) external payable",
    "function verifyCertificate(string certId) external view returns (string, uint256, bool)",
    "function revokeCertificate(string certId)",
    "function issuanceFee() external view returns (uint256)"
];

const contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    CONTRACT_ABI,
    wallet
);

// ============================================
// ASSET PRELOADING
// ============================================

const logoBuffers = {};
try {
    const assetsDir = path.join(__dirname, 'assets');
    if (fs.existsSync(assetsDir)) {
        try {
            if (fs.existsSync(path.join(assetsDir, 'logo1.jpg'))) {
                logoBuffers[1] = fs.readFileSync(path.join(assetsDir, 'logo1.jpg'));
            }
            if (fs.existsSync(path.join(assetsDir, 'logo2.jpg'))) {
                logoBuffers[2] = fs.readFileSync(path.join(assetsDir, 'logo2.jpg'));
            }
        } catch (e) {
            console.warn('⚠️ Could not load some logo assets');
        }
        console.log('✅ Asset preloading system initialized');
    } else {
        console.warn('⚠️ Assets directory not found');
    }
} catch (error) {
    console.error('❌ Error preloading assets:', error.message);
}

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

    // SecureCert green color
    const Green = rgb(0.04, 0.29, 0.20);
    const goldColor = rgb(0.72, 0.53, 0.04);
    const darkGray = rgb(0.2, 0.2, 0.2);

    // Attempt to load specific university logo
    let logoImage = null;
    try {
        const assetsDir = path.join(__dirname, 'assets');
        // Try .png then .jpg then .jpeg
        const possibleExtensions = ['.png', '.jpg', '.jpeg'];
        let logoBytes = null;
        let selectedExt = null;

        for (const ext of possibleExtensions) {
            const logoPath = path.join(assetsDir, `${certData.institution}${ext}`);
            if (fs.existsSync(logoPath)) {
                logoBytes = fs.readFileSync(logoPath);
                selectedExt = ext;
                break;
            }
        }

        if (logoBytes) {
            // Embed the image based on its type
            if (selectedExt === '.png' || logoBytes.slice(0, 4).toString('hex') === '89504e47') {
                logoImage = await pdfDoc.embedPng(logoBytes);
            } else {
                logoImage = await pdfDoc.embedJpg(logoBytes);
            }
        }
    } catch (error) {
        console.warn(`⚠️ Could not load logo for ${certData.institution}:`, error.message);
    }

    // Logo watermark removed as requested
    // Add subtle logo watermark as background
    if (logoImage) {
        try {
            const logoAspectRatio = logoImage.width / logoImage.height;
            const targetHeight = height * 0.5;
            const targetWidth = targetHeight * logoAspectRatio;

            page.drawImage(logoImage, {
                x: width / 2 - targetWidth / 2,
                y: height / 2 - targetHeight / 2,
                width: targetWidth,
                height: targetHeight,
                opacity: 0.05,
            });
        } catch (error) {
            console.error('Error adding logo watermark:', error.message);
        }
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
        borderColor: Green,
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
            color: Green,
        });
    });

    // Header logo removed as requested
    // Header logo - Dynamic based on university
    if (logoImage) {
        try {
            const logoAspectRatio = logoImage.width / logoImage.height;
            const logoHeight = 70;
            const logoWidth = logoHeight * logoAspectRatio;

            page.drawImage(logoImage, {
                x: width / 2 - logoWidth / 2,
                y: height - 120,
                width: logoWidth,
                height: logoHeight,
            });
        } catch (error) {
            console.error('Error adding header logo:', error.message);
        }
    }

    // University name (dynamically from certData)
    console.log('🎨 PDF Rendering Institution:', certData.institution);
    const universityText = String(certData.institution || 'SECURECERT VERIFIED').toUpperCase();
    const universitySize = 18;
    const universityWidth = timesBold.widthOfTextAtSize(universityText, universitySize);
    page.drawText(universityText, {
        x: width / 2 - universityWidth / 2,
        y: height - 135,
        size: universitySize,
        font: timesBold,
        color: Green,
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
        color: Green,
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
        color: Green,
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
    const sigTitle = 'Registrar, SecureCert';
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
        borderColor: Green,
        borderWidth: 2,
    });

    // Seal text
    page.drawText('OFFICIAL', {
        x: sealX - 20,
        y: sealY + 5,
        size: 8,
        font: helveticaBold,
        color: Green,
    });
    page.drawText('SEAL', {
        x: sealX - 12,
        y: sealY - 5,
        size: 8,
        font: helveticaBold,
        color: Green,
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
        color: Green
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

    // === VERIFICATION STAMP ===
    const stampText = `VERIFIED: ${certData.certId}`;
    const stampFontSize = 12;
    const stampTextWidth = helveticaBold.widthOfTextAtSize(stampText, stampFontSize);

    // Black badge at bottom
    page.drawRectangle({
        x: width / 2 - stampTextWidth / 2 - 10,
        y: 20,
        width: stampTextWidth + 20,
        height: 25,
        color: rgb(0, 0, 0),
    });

    page.drawText(stampText, {
        x: width / 2 - stampTextWidth / 2,
        y: 27,
        size: stampFontSize,
        font: helveticaBold,
        color: rgb(1, 1, 1),
    });

    // Large diagonal watermark
    const watermarkSize = 40;
    const watermarkWidth = helveticaBold.widthOfTextAtSize(certData.certId, watermarkSize);

    page.drawText(certData.certId, {
        x: width / 2 - watermarkWidth / 2,
        y: height / 2,
        size: watermarkSize,
        font: helveticaBold,
        color: rgb(0.8, 0.8, 0.8),
        opacity: 0.3,
        rotate: { type: 'degrees', angle: 45 },
    });

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

// Pin metadata to IPFS before MetaMask transaction
app.post('/api/certificates/pin-metadata', async (req, res, next) => {
    try {
        const { studentName, institution, course, grade, studentEmail } = req.body;
        const certId = `CERT${Date.now()}`;

        const metadata = {
            certId,
            studentName,
            institution,
            course,
            grade,
            issueDate: new Date().toISOString(),
            studentEmail: studentEmail || null
        };

        const metadataCID = await pinJSONToIPFS(metadata, certId);

        res.json({
            success: true,
            certId,
            metadataCID,
            metadata
        });
    } catch (error) {
        next(error);
    }
});

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
            const { studentName, institution, course, grade, studentEmail } = req.body;
            const certId = `CERT${Date.now()}`;

            console.log(`📝 Issuing certificate for: ${studentName}`);

            // Prepare metadata for IPFS
            const metadata = {
                certId,
                studentName,
                institution,
                course,
                grade,
                issueDate: new Date().toISOString(),
                studentEmail: studentEmail || null
            };

            // Pin metadata JSON to IPFS
            const metadataCID = await pinJSONToIPFS(metadata, certId);

            // Fetch issuance fee from contract
            const issuanceFee = await contract.issuanceFee();
            console.log(`💰 Paying issuance fee: ${ethers.formatEther(issuanceFee)} ETH`);

            // Issue on blockchain (Stores only CID)
            const tx = await contract.issueCertificate(certId, metadataCID, { value: issuanceFee });
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

            // Generate PDF and Pin to IPFS (the actual certificate document)
            const certData = { certId, studentName, institution, course, grade, issueDate: new Date(), txHash: tx.hash };
            const pdfBytes = await generateCertificatePDF(certData, qrCode);
            const ipfsCID = await pinToIPFS(Buffer.from(pdfBytes), certId);

            // Save to database using Prisma
            await prisma.certificate.create({
                data: {
                    certId,
                    studentName,
                    institution,
                    course,
                    grade,
                    issueDate: new Date().toISOString(),
                    txHash: tx.hash,
                    documentPath,
                    documentOriginalName: req.file?.originalname || null,
                    studentEmail: studentEmail || null,
                    ipfsCID
                }
            });

            console.log(`✅ Certificate issued: ${certId}`);

            res.json({
                success: true,
                certId,
                txHash: tx.hash,
                issueDate: new Date().toISOString(),
                hasDocument: !!documentPath,
                qrCode,
                verifyUrl: `${FRONTEND_URL}/verify/${certId}`,
                ipfsCID,
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

// Issue certificate metadata only (when transaction is signed by MetaMask via frontend)
app.post('/api/certificates/issue-metadata',
    upload.single('document'),
    [
        body('certId').trim().notEmpty().withMessage('Certificate ID is required'),
        body('studentName').trim().notEmpty().withMessage('Student name is required'),
        body('institution').trim().notEmpty().withMessage('Institution name is required'),
        body('course').trim().notEmpty().withMessage('Course is required'),
        body('grade').trim().notEmpty().withMessage('Grade is required'),
        body('txHash').trim().notEmpty().withMessage('Transaction Hash is required'),
        body('issueDate').trim().notEmpty().withMessage('Issue Date is required')
    ],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            console.log('📥 RECEIVED METADATA REQUEST:', req.body);
            let { certId, studentName, institution, course, grade, txHash, issueDate, studentEmail, metadataCID } = req.body;

            // Safety: Handle case where institution might be sent as an array
            if (Array.isArray(institution)) {
                institution = institution[0];
            }

            if (!institution) {
                console.warn('⚠️ WARNING: Institution is missing from request body!');
            }

            console.log(`📝 Saving MetaMask metadata for certificate: ${certId} (Institution: ${institution})`);

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

            // Generate PDF and Pin to IPFS
            const certData = {
                certId: certId,
                studentName: studentName,
                institution: institution,
                course: course,
                grade: grade,
                issueDate: new Date(),
                txHash: txHash
            };
            console.log('📦 Final certData for PDF:', certData);
            const pdfBytes = await generateCertificatePDF(certData, qrCode);
            const ipfsCID = await pinToIPFS(Buffer.from(pdfBytes), certId);

            // Save to database
            await prisma.certificate.create({
                data: {
                    certId,
                    studentName,
                    institution,
                    course,
                    grade,
                    issueDate,
                    txHash,
                    documentPath,
                    documentOriginalName: req.file?.originalname || null,
                    studentEmail: studentEmail || null,
                    ipfsCID
                }
            });

            console.log(`✅ Certificate metadata saved: ${certId}`);

            res.json({
                success: true,
                certId,
                txHash,
                issueDate,
                hasDocument: !!documentPath,
                qrCode,
                verifyUrl: `${FRONTEND_URL}/verify/${certId}`,
                ipfsCID,
                message: 'Certificate metadata saved successfully'
            });
        } catch (error) {
            console.error('❌ Issue Metadata error:', error);
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            res.status(500).json({
                error: 'Internal server error during metadata issuance',
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }
);

// Verify certificate (public)
app.get('/api/certificates/verify/:certId', async (req, res) => {
    try {
        const { certId } = req.params;

        // Get from blockchain
        const blockchainResult = await contract.verifyCertificate(certId);
        const metadataCID = blockchainResult[0];

        if (!metadataCID) {
            return res.status(404).json({ exists: false, error: "Certificate not found on blockchain" });
        }

        // Get from database
        let dbCert = await prisma.certificate.findUnique({
            where: { certId }
        });

        // SELF-HEALING: If certificate exists on-chain but not in DB, sync it from IPFS
        if (!dbCert && metadataCID) {
            console.log(`🩹 Self-healing: Syncing certificate ${certId} from IPFS...`);
            const metadata = await fetchFromIPFS(metadataCID);
            if (metadata) {
                dbCert = await prisma.certificate.create({
                    data: {
                        certId: metadata.certId,
                        studentName: metadata.studentName,
                        institution: metadata.institution,
                        course: metadata.course,
                        grade: metadata.grade,
                        issueDate: metadata.issueDate,
                        txHash: "0x0000000000000000000000000000000000000000", // placeholder as tx info isn't in metadata
                        studentEmail: metadata.studentEmail,
                        ipfsCID: metadataCID
                    }
                });
                console.log(`✅ Sync complete for ${certId}`);
            }
        }

        // Generate QR code for verification link
        const qrCode = await generateQRCode(certId);

        res.json({
            exists: true,
            certId: dbCert?.certId || certId,
            studentName: dbCert?.studentName || "Unknown",
            institution: dbCert?.institution || "SecureCert Institute",
            course: dbCert?.course || "Unknown",
            grade: dbCert?.grade || "N/A",
            issueDate: dbCert?.issueDate || new Date(Number(blockchainResult[1]) * 1000).toISOString(),
            txHash: dbCert?.txHash || "0x0",
            isRevoked: blockchainResult[2],
            hasDocument: !!dbCert?.documentPath,
            qrCode,
            ipfsCID: metadataCID
        });
    } catch (error) {
        console.error('Verify error:', error);
        if (error.message.includes("Certificate does not exist")) {
            return res.status(404).json({ exists: false, error: "Certificate not found on blockchain" });
        }
        res.status(500).json({ error: error.message });
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
        if (result[2]) { // isRevoked is now at index 2
            return res.status(400).json({ error: 'Certificate has been revoked' });
        }

        // Get from database
        const dbCert = await prisma.certificate.findUnique({ where: { certId } });

        const certData = {
            certId,
            studentName: dbCert?.studentName || "Unknown",
            institution: dbCert?.institution || "SECURECERT VERIFIED",
            course: dbCert?.course || "Unknown",
            grade: dbCert?.grade || "N/A",
            issueDate: dbCert?.issueDate || new Date(Number(result[1]) * 1000), // issueDate is now at index 1
            txHash: dbCert?.txHash || "0x0"
        };

        // Generate QR code and PDF
        const qrCode = await generateQRCode(certId);
        const pdfBytes = await generateCertificatePDF(certData, qrCode);

        res.setHeader('Content-Type', 'application/pdf');
        if (req.query.view === 'true') {
            res.setHeader('Content-Disposition', 'inline');
        } else {
            res.setHeader('Content-Disposition', `attachment; filename="${certId}_certificate.pdf"`);
        }
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error(`❌ PDF generation error for certificate ${req.params.certId}:`, error);

        if (error.message.includes("Certificate does not exist")) {
            res.status(404).json({ error: 'Certificate not found on blockchain' });
        } else if (error.code === 'NETWORK_ERROR' || error.message.includes('network')) {
            res.status(503).json({ error: 'Blockchain network unreachable' });
        } else {
            res.status(500).json({
                error: 'Internal server error during PDF generation',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
});

// Download stamped document
app.get('/api/certificates/download/:certId', async (req, res) => {
    try {
        const { certId } = req.params;
        const result = await contract.verifyCertificate(certId);

        if (result[2]) { // isRevoked is now at index 2
            return res.status(400).json({ error: 'Certificate has been revoked' });
        }

        const dbCert = await prisma.certificate.findUnique({ where: { certId } });
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
            if (req.query.view === 'true') {
                res.setHeader('Content-Disposition', 'inline');
            } else {
                res.setHeader('Content-Disposition', `attachment; filename="stamped_${certId}.pdf"`);
            }
            res.send(Buffer.from(stampedPdfBytes));
        } else {
            if (req.query.view === 'true') {
                res.setHeader('Content-Disposition', 'inline');
            } else {
                res.setHeader('Content-Disposition', `attachment; filename="${certId}${ext}"`);
            }
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
        const allCerts = await prisma.certificate.findMany({ orderBy: { createdAt: 'desc' } });

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
        const dbCert = await prisma.certificate.findUnique({ where: { certId } });

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
            const updateData = {};
            if (req.body.notes !== undefined) updateData.notes = req.body.notes;
            if (req.file) {
                const ext = path.extname(req.file.originalname);
                updateData.documentPath = `${certId}${ext}`;
                updateData.documentOriginalName = req.file.originalname;
            }
            await prisma.certificate.update({ where: { certId }, data: updateData });
        }

        const updatedCert = await prisma.certificate.findUnique({ where: { certId } });

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

        // Check if exists
        const blockchainResult = await contract.verifyCertificate(certId);
        if (blockchainResult[2]) {
            return res.status(400).json({ error: 'Certificate is already revoked' });
        }

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
        } else {
            console.error('Revoke certificate error:', error);
            res.status(500).json({ error: error.message });
        }
    }
});

app.delete('/api/admin/certificates/:certId', authenticateToken, async (req, res) => {
    try {
        const { certId } = req.params;
        const dbCert = await prisma.certificate.findUnique({
            where: { certId }
        });

        if (!dbCert) {
            return res.status(404).json({ error: 'Certificate not found' });
        }

        // Check blockchain status and revoke if active
        try {
            const result = await contract.verifyCertificate(certId);
            const isRevoked = result[2];

            if (!isRevoked) {
                console.log(`⚠️ Auto-revoking certificate ${certId} before deletion...`);
                const tx = await contract.revokeCertificate(certId);
                await tx.wait();
                console.log(`✅ Certificate ${certId} revoked on blockchain.`);
            }
        } catch (blockchainError) {
            if (!blockchainError.message.includes("Certificate does not exist")) {
                console.error('Blockchain revocation failed during delete:', blockchainError);
            }
        }

        if (dbCert.documentPath) {
            const filePath = path.join(__dirname, 'uploads', dbCert.documentPath);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await prisma.certificate.delete({
            where: { certId }
        });

        res.json({
            success: true,
            message: 'Certificate revoked on blockchain and deleted from database.'
        });
    } catch (error) {
        console.error('Delete certificate error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Admin API: Batch revoke certificates on blockchain.
 */
app.post('/api/admin/certificates/batch-revoke', authenticateToken, async (req, res) => {
    try {
        const { certIds } = req.body;
        if (!certIds || !Array.isArray(certIds)) {
            return res.status(400).json({ error: 'Array of certificate IDs is required' });
        }

        console.log(`🔄 Batch revoking ${certIds.length} certificates...`);

        // Note: Looping individually since contract doesn't have batchRevoke
        const results = [];
        for (const certId of certIds) {
            try {
                const tx = await contract.revokeCertificate(certId);
                await tx.wait();
                results.push({ certId, success: true, txHash: tx.hash });
            } catch (err) {
                results.push({ certId, success: false, error: err.message });
            }
        }

        res.json({
            message: `Batch processing complete. ${results.filter(r => r.success).length} revoked, ${results.filter(r => !r.success).length} failed.`,
            results
        });
    } catch (error) {
        console.error('Batch revoke error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Admin API: Batch delete certificates from database.
 */
app.post('/api/admin/certificates/batch-delete', authenticateToken, async (req, res) => {
    try {
        const { certIds } = req.body;
        if (!certIds || !Array.isArray(certIds)) {
            return res.status(400).json({ error: 'Array of certificate IDs is required' });
        }

        console.log(`🗑️ Batch deleting ${certIds.length} certificates...`);

        // Get info about documents to delete
        const certsToDelete = await prisma.certificate.findMany({
            where: { certId: { in: certIds } }
        });

        // Delete physical files
        for (const cert of certsToDelete) {
            if (cert.documentPath) {
                const filePath = path.join(__dirname, 'uploads', cert.documentPath);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        }

        // Delete from database
        const deleteResult = await prisma.certificate.deleteMany({
            where: { certId: { in: certIds } }
        });

        res.json({
            message: `Successfully deleted ${deleteResult.count} certificates from database.`,
            count: deleteResult.count
        });
    } catch (error) {
        console.error('Batch delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Legacy endpoint (removed duplicate)

// CSV Bulk Issue Endpoint
const uploadMemory = multer({ storage: multer.memoryStorage() });

/**
 * Admin API: Bulk issuance of certificates via CSV upload.
 * Processes certificates in batches for optimized gas efficiency.
 */
app.post('/api/admin/certificates/bulk-issue', authenticateToken, uploadMemory.single('csvFile'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

        const institution = req.body.institution || 'SecureCert Institute';
        const rows = [];

        // Parse CSV from buffer
        const parser = require('stream').Readable.from(req.file.buffer);
        parser
            .pipe(csv())
            .on('data', (data) => {
                // expecting columns: studentName, course, grade, email
                if (data.studentName && data.course && data.grade) {
                    rows.push({
                        studentName: data.studentName.trim(),
                        course: data.course.trim(),
                        grade: data.grade.trim(),
                        email: data.email ? data.email.trim() : null
                    });
                }
            })
            .on('end', async () => {
                if (rows.length === 0) {
                    return res.status(400).json({ error: 'No valid rows found in CSV' });
                }

                res.status(202).json({ message: `Processing ${rows.length} certificates... This may take a moment.` });

                // Process in batches of 20 to avoiding gas limit issues
                const BATCH_SIZE = 20;
                let processed = 0;

                for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                    const batch = rows.slice(i, i + BATCH_SIZE);
                    const b_ids = [];
                    const b_cids = [];

                    const timestamp = Date.now();
                    for (let j = 0; j < batch.length; j++) {
                        const certId = `CERT${timestamp}${i + j}`;
                        const studentData = batch[j];

                        // Prepare metadata
                        const metadata = {
                            certId,
                            studentName: studentData.studentName,
                            institution,
                            course: studentData.course,
                            grade: studentData.grade,
                            issueDate: new Date().toISOString(),
                            studentEmail: studentData.email
                        };

                        // Pin metadata to IPFS
                        console.log(`📌 Pinning metadata for ${certId}...`);
                        const metadataCID = await pinJSONToIPFS(metadata, certId);

                        b_ids.push(certId);
                        b_cids.push(metadataCID);
                    }

                    try {
                        const feePerCert = await contract.issuanceFee();
                        const totalBatchFee = feePerCert * BigInt(b_ids.length);

                        console.log(`🔄 Minting batch ${i / BATCH_SIZE + 1} (${b_ids.length} certs) - Fee: ${ethers.formatEther(totalBatchFee)} ETH...`);
                        const tx = await contract.batchIssueCertificates(b_ids, b_cids, { value: totalBatchFee });
                        await tx.wait();

                        // DB insertion
                        for (let j = 0; j < batch.length; j++) {
                            const certId = b_ids[j];
                            const studentData = batch[j];
                            const metadataCID = b_cids[j];

                            try {
                                // Generate QR and PDF
                                const qrCode = await generateQRCode(certId);
                                const certData = { certId, studentName: studentData.studentName, institution, course: studentData.course, grade: studentData.grade, issueDate: new Date(), txHash: tx.hash };
                                const pdfBytes = await generateCertificatePDF(certData, qrCode);

                                // Pin PDF to IPFS
                                const ipfsCID = await pinToIPFS(Buffer.from(pdfBytes), certId);

                                // Save to database
                                await prisma.certificate.create({
                                    data: {
                                        certId,
                                        studentName: studentData.studentName,
                                        institution,
                                        course: studentData.course,
                                        grade: studentData.grade,
                                        issueDate: new Date().toISOString(),
                                        txHash: tx.hash,
                                        studentEmail: studentData.email,
                                        ipfsCID
                                    }
                                });

                                processed++;
                            } catch (itemErr) {
                                console.error(`Error processing individual certificate ${certId}:`, itemErr);
                            }
                        }
                    } catch (batchErr) {
                        console.error('Batch error:', batchErr);
                    }
                }
                console.log(`✅ Bulk issuance complete: ${processed} credentials minted`);
            });
    } catch (error) {
        console.error('Bulk issue error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

app.get('/api/admin/stats', authenticateToken, async (req, res) => {
    try {
        const allCerts = await prisma.certificate.findMany();
        let revokedCount = 0;
        let validCount = 0;

        for (const cert of allCerts) {
            try {
                const result = await contract.verifyCertificate(cert.certId);
                if (result[2]) { // isRevoked
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
app.get('/api/certificates', async (req, res) => {
    const certs = await prisma.certificate.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(certs);
});

// Apply error handler (must be last)
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
console.log(`Starting server on port ${PORT}...`);

const server = app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Certificate Verification Server Started');
    console.log('='.repeat(50));
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`🌐 Frontend: ${process.env.FRONTEND_URL}`);
    console.log(`⛓️  Blockchain: ${process.env.RPC_URL}`);
    console.log(`📜 Contract: ${process.env.CONTRACT_ADDRESS}`);
    console.log('='.repeat(50) + '\n');
    console.log('made with love by TIFE');
    console.log(`💾 Database: Connected (Prisma)`);
});

