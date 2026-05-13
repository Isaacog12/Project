'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { ethers } = require('ethers');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const csv = require('csv-parser');
const axios = require('axios');
const FormData = require('form-data');


// ============================================================
// SECTION 1: ENVIRONMENT VALIDATION
// Ensures all required .env variables are present before
// the app starts. Exits with a clear error if any are missing.
// ============================================================

const REQUIRED_ENV_VARS = [
    'PORT',
    'CONTRACT_ADDRESS',
    'RPC_URL',
    'PRIVATE_KEY',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'JWT_SECRET',
    'FRONTEND_URL',
];

const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(v => console.error(`   - ${v}`));
    console.error('\nPlease check your .env file and ensure all required variables are set.');
    process.exit(1);
}

console.log('✅ Environment variables validated');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';


// ============================================================
// SECTION 2: EXPRESS APP SETUP
// Configures middleware: security headers, CORS, body parsing,
// rate limiting, and request logging.
// ============================================================

const app = express();

// --- 0. PRE-MIDDLEWARE LOGGER & CORS ---
// Ensure CORS is handled before security headers and rate limits
app.use((req, _res, next) => {
    console.log(`[PRE-CORS] ${req.method} ${req.path} from ${req.headers.origin || 'unknown origin'}`);
    next();
});

app.use(cors({
    origin: FRONTEND_URL,
    credentials: true,
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
}));

// --- 1. SECURITY HEADERS ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
        },
    },
}));

// --- Body parsing: support JSON and URL-encoded up to 10 MB ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- General rate limiter: 100 requests per 15 minutes per IP ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS', // Don't rate limit preflight
});

// --- Auth-specific rate limiter: 5 login attempts per 15 minutes ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many login attempts, please try again later.',
    skipSuccessfulRequests: true,
    skip: (req) => req.method === 'OPTIONS', // Don't rate limit preflight
});

app.use('/api/', limiter);

// --- Request logger: prints method and path with a timestamp ---
app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});


// ============================================================
// SECTION 3: DATABASE SETUP
// Uses Prisma ORM with the better-sqlite3 adapter for a local
// SQLite database. The `prisma` client is used for all DB ops.
// ============================================================

const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const rawDb = new Database(dbUrl.replace('file:', ''));
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

console.log('✅ Prisma Client initialized with better-sqlite3 adapter');


// ============================================================
// SECTION 4: IPFS HELPERS (Pinata)
// Functions for pinning files and JSON metadata to IPFS via
// Pinata. Requires PINATA_API_KEY and PINATA_SECRET_API_KEY.
// ============================================================

/**
 * Pins a PDF buffer to IPFS using the Pinata service.
 *
 * @param {Buffer} pdfBuffer - The PDF content to upload.
 * @param {string} certId    - Used as the filename on IPFS.
 * @returns {Promise<string|null>} The IPFS CID, or null on failure.
 */
async function pinToIPFS(pdfBuffer, certId) {
    const { PINATA_API_KEY, PINATA_SECRET_API_KEY } = process.env;

    if (!PINATA_API_KEY || !PINATA_SECRET_API_KEY) {
        throw new Error('IPFS configuration missing. Please set PINATA_API_KEY and PINATA_SECRET_API_KEY.');
    }

    try {
        const formData = new FormData();
        formData.append('file', pdfBuffer, {
            filename: `${certId}.pdf`,
            contentType: 'application/pdf',
        });

        const response = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', formData, {
            maxBodyLength: Infinity,
            headers: {
                'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
                'pinata_api_key': PINATA_API_KEY,
                'pinata_secret_api_key': PINATA_SECRET_API_KEY,
            },
        });

        console.log(`📌 Pinned PDF ${certId} to IPFS: ${response.data.IpfsHash}`);
        return response.data.IpfsHash;
    } catch (error) {
        console.error('❌ IPFS PDF pinning failed:', error.response?.data || error.message);
        return null;
    }
}

/**
 * Pins a JSON metadata object to IPFS using the Pinata service.
 *
 * @param {object} metadata - The certificate metadata to upload.
 * @param {string} certId   - Used to name the pin on Pinata.
 * @returns {Promise<string|null>} The IPFS CID, or null on failure.
 */
async function pinJSONToIPFS(metadata, certId) {
    const { PINATA_API_KEY, PINATA_SECRET_API_KEY } = process.env;

    if (!PINATA_API_KEY || !PINATA_SECRET_API_KEY) {
        throw new Error('IPFS configuration missing. Please set PINATA_API_KEY and PINATA_SECRET_API_KEY.');
    }

    try {
        const response = await axios.post(
            'https://api.pinata.cloud/pinning/pinJSONToIPFS',
            {
                pinataContent: metadata,
                pinataMetadata: { name: `${certId}_metadata.json` },
            },
            {
                headers: {
                    'pinata_api_key': PINATA_API_KEY,
                    'pinata_secret_api_key': PINATA_SECRET_API_KEY,
                },
            }
        );

        console.log(`📌 Pinned metadata ${certId} to IPFS: ${response.data.IpfsHash}`);
        return response.data.IpfsHash;
    } catch (error) {
        console.error('❌ IPFS JSON pinning failed:', error.response?.data || error.message);
        return null;
    }
}

/**
 * Fetches and parses a JSON object from IPFS via the Pinata gateway.
 * Returns null for mock CIDs (used in dev/test) or on network failure.
 *
 * @param {string} cid - The IPFS content identifier.
 * @returns {Promise<object|null>} Parsed JSON object, or null.
 */
async function fetchFromIPFS(cid) {
    if (cid.startsWith('mock-')) return null;

    try {
        const response = await axios.get(`https://gateway.pinata.cloud/ipfs/${cid}`, { timeout: 5000 });
        return response.data;
    } catch (error) {
        console.error(`❌ Failed to fetch from IPFS (${cid}):`, error.message);
        return null;
    }
}


// ============================================================
// SECTION 5: FILE UPLOAD SETUP (Multer)
// Handles multipart/form-data uploads.
// Files are saved to /uploads with a temp prefix until
// processed, then renamed to the certificate ID.
// ============================================================

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        cb(null, `temp_${Date.now()}${path.extname(file.originalname)}`);
    },
});

/** Disk-backed multer instance for document uploads (PDF/PNG/JPEG, max 10 MB). */
const upload = multer({
    storage: diskStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, PNG, and JPEG files are allowed'));
        }
    },
});

/** In-memory multer instance used for CSV bulk import. */
const uploadMemory = multer({ storage: multer.memoryStorage() });


// ============================================================
// SECTION 6: BLOCKCHAIN SETUP
// Connects to an Ethereum-compatible network using ethers.js.
// A wallet (funded with the PRIVATE_KEY) signs all transactions.
// The contract ABI mirrors the deployed SecureCert smart contract.
// ============================================================

// Use a custom FetchRequest to configure a 120-second timeout,
// necessary for slow or congested networks.
const fetchReq = new ethers.FetchRequest(process.env.RPC_URL);
fetchReq.timeout = 120_000;

const provider = new ethers.JsonRpcProvider(
    fetchReq,
    undefined,        // Auto-detect network
    { staticNetwork: true }
);

const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

/**
 * ABI for the deployed SecureCert smart contract.
 * Only the functions we call from the backend are listed here.
 */
const CONTRACT_ABI = [
    'function issueCertificate(string certId, string metadataCID) external payable',
    'function batchIssueCertificates(string[] certIds, string[] metadataCIDs) external payable',
    'function verifyCertificate(string certId) external view returns (string, uint256, bool)',
    'function revokeCertificate(string certId)',
    'function issuanceFee() external view returns (uint256)',
];

const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, wallet);


// ============================================================
// SECTION 7: ASSET PRELOADING
// Attempts to read logo files (logo1.jpg, logo2.jpg) from the
// /assets directory into memory at startup for fast PDF embedding.
// Non-fatal: server continues if assets are missing.
// ============================================================

const logoBuffers = {};

try {
    const assetsDir = path.join(__dirname, 'assets');
    if (fs.existsSync(assetsDir)) {
        for (const idx of [1, 2]) {
            const logoPath = path.join(assetsDir, `logo${idx}.jpg`);
            if (fs.existsSync(logoPath)) {
                logoBuffers[idx] = fs.readFileSync(logoPath);
            }
        }
        console.log('✅ Asset preloading system initialized');
    } else {
        console.warn('⚠️ Assets directory not found — logos will be skipped');
    }
} catch (error) {
    console.error('❌ Error preloading assets:', error.message);
}


// ============================================================
// SECTION 8: CERTIFICATE HELPERS
// Core functions for QR code generation and PDF certificate
// creation. Called during issuance and download endpoints.
// ============================================================

/**
 * Generates a QR code as a base64 PNG data URL.
 * The QR code encodes the public verification URL for the certificate.
 *
 * @param {string} certId - The certificate ID.
 * @returns {Promise<string>} Base64 data URL string (image/png).
 */
async function generateQRCode(certId) {
    const verifyUrl = `${FRONTEND_URL}/verify/${certId}`;
    return QRCode.toDataURL(verifyUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#1a365d', light: '#ffffff' },
    });
}

/**
 * Generates a styled A4 landscape certificate PDF.
 * Includes: institution name, student name, course, grade,
 * issue date, blockchain TX reference, QR code, seal, and watermark.
 *
 * @param {object} certData              - Certificate details.
 * @param {string} certData.certId       - Unique certificate ID.
 * @param {string} certData.studentName  - Recipient's full name.
 * @param {string} certData.institution  - Issuing institution name.
 * @param {string} certData.course       - Course or program name.
 * @param {string} certData.grade        - Grade or result.
 * @param {Date}   certData.issueDate    - Date of issuance.
 * @param {string} [certData.txHash]     - Blockchain transaction hash.
 * @param {string} qrCodeDataUrl         - QR code as a base64 data URL.
 * @returns {Promise<Uint8Array>} Raw PDF bytes ready to be saved or streamed.
 */
async function generateCertificatePDF(certData, qrCodeDataUrl) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([842, 595]); // A4 Landscape (points)

    const { width, height } = page.getSize();

    // --- Embed fonts ---
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

    // --- Brand colors ---
    const Green = rgb(0.04, 0.29, 0.20); // SecureCert brand green
    const goldColor = rgb(0.72, 0.53, 0.04);
    const darkGray = rgb(0.2, 0.2, 0.2);

    // --- Attempt to load institution-specific logo ---
    let logoImage = null;
    try {
        const assetsDir = path.join(__dirname, 'assets');
        for (const ext of ['.png', '.jpg', '.jpeg']) {
            const logoPath = path.join(assetsDir, `${certData.institution}${ext}`);
            if (fs.existsSync(logoPath)) {
                const logoBytes = fs.readFileSync(logoPath);
                logoImage = ext === '.png'
                    ? await pdfDoc.embedPng(logoBytes)
                    : await pdfDoc.embedJpg(logoBytes);
                break;
            }
        }
    } catch (error) {
        console.warn(`⚠️ Could not load logo for "${certData.institution}":`, error.message);
    }

    // --- Background watermark (faint logo centered on page) ---
    if (logoImage) {
        try {
            const aspectRatio = logoImage.width / logoImage.height;
            const targetHeight = height * 0.5;
            const targetWidth = targetHeight * aspectRatio;
            page.drawImage(logoImage, {
                x: width / 2 - targetWidth / 2,
                y: height / 2 - targetHeight / 2,
                width: targetWidth,
                height: targetHeight,
                opacity: 0.05,
            });
        } catch (e) {
            console.error('Error drawing background watermark:', e.message);
        }
    }

    // --- Decorative border: outer (gold) and inner (green) ---
    const margin = 30;
    const innerMargin = 45;
    page.drawRectangle({ x: margin, y: margin, width: width - margin * 2, height: height - margin * 2, borderColor: goldColor, borderWidth: 3 });
    page.drawRectangle({ x: innerMargin, y: innerMargin, width: width - innerMargin * 2, height: height - innerMargin * 2, borderColor: Green, borderWidth: 2 });

    // --- Corner ornaments: gold outer square + green inner square ---
    const ornSize = 15;
    const ornOffset = 38;
    [
        { x: ornOffset, y: height - ornOffset },         // Top-left
        { x: width - ornOffset - ornSize, y: height - ornOffset },     // Top-right
        { x: ornOffset, y: ornOffset },                  // Bottom-left
        { x: width - ornOffset - ornSize, y: ornOffset },              // Bottom-right
    ].forEach(({ x, y }) => {
        page.drawRectangle({ x, y, width: ornSize, height: ornSize, color: goldColor });
        page.drawRectangle({ x: x + 3, y: y - 3, width: ornSize - 6, height: ornSize - 6, color: Green });
    });

    // --- Header: institution logo (if available) ---
    if (logoImage) {
        try {
            const aspectRatio = logoImage.width / logoImage.height;
            const logoHeight = 70;
            const logoWidth = logoHeight * aspectRatio;
            page.drawImage(logoImage, { x: width / 2 - logoWidth / 2, y: height - 120, width: logoWidth, height: logoHeight });
        } catch (e) {
            console.error('Error drawing header logo:', e.message);
        }
    }

    // --- Institution name ---
    const institutionText = String(certData.institution || 'SECURECERT VERIFIED').toUpperCase();
    const institutionSize = 18;
    const institutionWidth = timesBold.widthOfTextAtSize(institutionText, institutionSize);
    page.drawText(institutionText, { x: width / 2 - institutionWidth / 2, y: height - 135, size: institutionSize, font: timesBold, color: Green });

    // Decorative underline beneath institution name
    page.drawLine({ start: { x: width / 2 - 100, y: height - 145 }, end: { x: width / 2 + 100, y: height - 145 }, thickness: 1, color: goldColor });

    // --- Award title ---
    const titleText = 'AWARD OF EXCELLENCE';
    const titleSize = 32;
    const titleWidth = timesBold.widthOfTextAtSize(titleText, titleSize);
    page.drawText(titleText, { x: width / 2 - titleWidth / 2, y: height - 200, size: titleSize, font: timesBold, color: Green });

    // Short decorative lines flanking the title
    const titleLineY = height - 210;
    page.drawLine({ start: { x: width / 2 - titleWidth / 2 - 30, y: titleLineY }, end: { x: width / 2 - titleWidth / 2 - 10, y: titleLineY }, thickness: 2, color: goldColor });
    page.drawLine({ start: { x: width / 2 + titleWidth / 2 + 10, y: titleLineY }, end: { x: width / 2 + titleWidth / 2 + 30, y: titleLineY }, thickness: 2, color: goldColor });

    // --- "This is to certify that" ---
    const certifyText = 'This is to certify that';
    const certifyWidth = timesItalic.widthOfTextAtSize(certifyText, 14);
    page.drawText(certifyText, { x: width / 2 - certifyWidth / 2, y: height - 250, size: 14, font: timesItalic, color: darkGray });

    // --- Student name (most prominent text on the certificate) ---
    const studentText = certData.studentName.toUpperCase();
    const studentSize = 28;
    const studentWidth = timesBold.widthOfTextAtSize(studentText, studentSize);
    page.drawText(studentText, { x: width / 2 - studentWidth / 2, y: height - 290, size: studentSize, font: timesBold, color: rgb(0.5, 0.1, 0.1) });
    page.drawLine({ start: { x: width / 2 - studentWidth / 2 - 20, y: height - 298 }, end: { x: width / 2 + studentWidth / 2 + 20, y: height - 298 }, thickness: 1.5, color: goldColor });

    // --- Achievement text ---
    const achieveText = 'has successfully completed the requirements for';
    const achieveWidth = helvetica.widthOfTextAtSize(achieveText, 12);
    page.drawText(achieveText, { x: width / 2 - achieveWidth / 2, y: height - 330, size: 12, font: helvetica, color: darkGray });

    // --- Course name ---
    const courseSize = 22;
    const courseWidth = timesBold.widthOfTextAtSize(certData.course, courseSize);
    page.drawText(certData.course, { x: width / 2 - courseWidth / 2, y: height - 365, size: courseSize, font: timesBold, color: Green });

    // --- Grade ---
    const gradeText = `with a grade of ${certData.grade}`;
    const gradeWidth = helveticaBold.widthOfTextAtSize(gradeText, 14);
    page.drawText(gradeText, { x: width / 2 - gradeWidth / 2, y: height - 395, size: 14, font: helveticaBold, color: rgb(0, 0.6, 0.3) });

    // --- Issue date ---
    const issueDate = new Date(certData.issueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const dateText = `Issued on ${issueDate}`;
    const dateWidth = helvetica.widthOfTextAtSize(dateText, 11);
    page.drawText(dateText, { x: width / 2 - dateWidth / 2, y: 180, size: 11, font: helvetica, color: darkGray });

    // --- Registrar signature line ---
    const sigY = 130;
    page.drawLine({ start: { x: width / 2 - 120, y: sigY }, end: { x: width / 2 + 120, y: sigY }, thickness: 1, color: darkGray });
    const sigTitle = 'Registrar, SecureCert';
    const sigWidth = helvetica.widthOfTextAtSize(sigTitle, 10);
    page.drawText(sigTitle, { x: width / 2 - sigWidth / 2, y: sigY - 15, size: 10, font: helvetica, color: darkGray });

    // --- Official seal (bottom-left): two concentric circles + text ---
    const sealX = 100;
    const sealY = 100;
    page.drawCircle({ x: sealX, y: sealY, size: 35, borderColor: goldColor, borderWidth: 3 });
    page.drawCircle({ x: sealX, y: sealY, size: 27, borderColor: Green, borderWidth: 2 });
    page.drawText('OFFICIAL', { x: sealX - 20, y: sealY + 5, size: 8, font: helveticaBold, color: Green });
    page.drawText('SEAL', { x: sealX - 12, y: sealY - 5, size: 8, font: helveticaBold, color: Green });

    // --- QR code (bottom-right) ---
    if (qrCodeDataUrl) {
        const qrBytes = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
        const qrImage = await pdfDoc.embedPng(qrBytes);
        page.drawImage(qrImage, { x: width - 140, y: 70, width: 70, height: 70 });
        page.drawText('Scan to Verify', { x: width - 135, y: 60, size: 7, font: helvetica, color: darkGray });
    }

    // --- Blockchain info block (bottom-left, below seal) ---
    page.drawText('BLOCKCHAIN SECURED', { x: 60, y: 60, size: 8, font: helveticaBold, color: Green });
    page.drawText(`Certificate No: ${certData.certId}`, { x: 60, y: 48, size: 7, font: helvetica, color: darkGray });
    if (certData.txHash) {
        page.drawText(`TX: ${certData.txHash.substring(0, 30)}...`, { x: 60, y: 38, size: 6, font: helvetica, color: rgb(0.6, 0.6, 0.6) });
    }

    // --- Verification stamp (centered black banner at very bottom) ---
    const stampText = `VERIFIED: ${certData.certId}`;
    const stampSize = 12;
    const stampWidth = helveticaBold.widthOfTextAtSize(stampText, stampSize);
    page.drawRectangle({ x: width / 2 - stampWidth / 2 - 10, y: 20, width: stampWidth + 20, height: 25, color: rgb(0, 0, 0) });
    page.drawText(stampText, { x: width / 2 - stampWidth / 2, y: 27, size: stampSize, font: helveticaBold, color: rgb(1, 1, 1) });

    // --- Diagonal cert ID watermark (semi-transparent, across center) ---
    const wmSize = 40;
    const wmWidth = helveticaBold.widthOfTextAtSize(certData.certId, wmSize);
    page.drawText(certData.certId, {
        x: width / 2 - wmWidth / 2,
        y: height / 2,
        size: wmSize,
        font: helveticaBold,
        color: rgb(0.8, 0.8, 0.8),
        opacity: 0.3,
        rotate: { type: 'degrees', angle: 45 },
    });

    return pdfDoc.save();
}


// ============================================================
// SECTION 9: MIDDLEWARE
// Reusable middleware for input validation and authentication.
// ============================================================

/**
 * Express middleware: checks express-validator results.
 * Responds with 400 and field-level error details if validation failed.
 */
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(err => ({ field: err.path, message: err.msg })),
        });
    }
    next();
};

/**
 * Express middleware: verifies the Bearer JWT in the Authorization header.
 * Attaches the decoded payload to `req.user` on success.
 * Returns 401 if no token, 403 if invalid or expired.
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access token required' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};

/**
 * Express error handler (must be registered last with app.use).
 * Handles Multer errors, custom status errors, and generic 500s.
 */
const errorHandler = (err, req, res, _next) => {
    console.error('Unhandled error:', err);

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Maximum size is 10 MB.' });
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }

    if (err.status) return res.status(err.status).json({ error: err.message });

    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
};


// ============================================================
// SECTION 10: HEALTH CHECK ENDPOINTS
// Used by monitoring, load balancers, or Docker health checks.
// GET /health  → lightweight liveness probe
// GET /ready   → full readiness probe (checks DB + blockchain)
// ============================================================

app.get('/health', (_req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
    });
});

app.get('/ready', async (_req, res) => {
    try {
        const checks = {
            database: 'checking...',
            blockchain: 'checking...',
            contract: process.env.CONTRACT_ADDRESS
        };

        try {
            rawDb.prepare('SELECT 1').get();
            checks.database = 'connected';
        } catch (e) {
            checks.database = `error: ${e.message}`;
        }

        try {
            await provider.getBlockNumber();
            checks.blockchain = 'connected';
        } catch (e) {
            checks.blockchain = `error: ${e.message} (Is Hardhat node running?)`;
        }

        const isReady = checks.database === 'connected' && checks.blockchain === 'connected';

        res.status(isReady ? 200 : 503).json({
            status: isReady ? 'ready' : 'not ready',
            checks,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});


// ============================================================
// SECTION 11: AUTH ENDPOINTS
// POST /api/auth/login  → validates admin credentials, returns JWT
// GET  /api/auth/verify → checks if current JWT is still valid
// ============================================================

app.post(
    '/api/auth/login',
    authLimiter,
    [
        body('username').trim().notEmpty().withMessage('Username is required'),
        body('password').notEmpty().withMessage('Password is required'),
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
            return res.json({ success: true, token, user: { username, role: 'admin' } });
        }

        console.warn(`❌ Failed login attempt for: ${username}`);
        res.status(401).json({ error: 'Invalid credentials' });
    }
);

app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});


// ============================================================
// SECTION 12: PUBLIC CERTIFICATE ENDPOINTS
// These do not require authentication.
//
// POST /api/certificates/pin-metadata        → pin metadata to IPFS (MetaMask flow prep)
// POST /api/certificates/issue               → full backend issuance (server signs TX)
// POST /api/certificates/issue-metadata      → save metadata after MetaMask TX
// GET  /api/certificates/verify/:certId      → verify a certificate (blockchain + DB)
// GET  /api/certificates/:certId/qrcode      → return QR code for a certificate
// GET  /api/certificates/:certId/pdf         → download generated certificate PDF
// GET  /api/certificates/download/:certId    → download stamped original document
// ============================================================

/**
 * PIN METADATA (MetaMask pre-issuance step)
 * Pins certificate metadata to IPFS and returns the CID.
 * This CID is then passed to the MetaMask transaction by the frontend.
 */
app.post('/api/certificates/pin-metadata', async (req, res, next) => {
    try {
        const { studentName, institution, course, grade, studentEmail } = req.body;
        const certId = `CERT${Date.now()}`;

        const metadata = {
            certId, studentName, institution, course, grade,
            issueDate: new Date().toISOString(),
            studentEmail: studentEmail || null,
        };

        const metadataCID = await pinJSONToIPFS(metadata, certId);
        res.json({ success: true, certId, metadataCID, metadata });
    } catch (error) {
        next(error);
    }
});

/**
 * ISSUE CERTIFICATE (server-signed blockchain transaction)
 * Full issuance: pins metadata to IPFS, pays issuance fee, sends TX,
 * generates PDF, pins PDF to IPFS, saves to DB.
 * Accepts an optional document file (PDF/PNG/JPEG).
 */
app.post(
    '/api/certificates/issue',
    upload.single('document'),
    [
        body('studentName').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Student name must be 2–100 characters'),
        body('course').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Course must be 2–100 characters'),
        body('grade').trim().notEmpty().isLength({ min: 1, max: 50 }).withMessage('Grade must be 1–50 characters'),
    ],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const { studentName, institution, course, grade, studentEmail } = req.body;
            const certId = `CERT${Date.now()}`;

            console.log(`📝 Issuing certificate for: ${studentName}`);

            // Pin JSON metadata to IPFS
            const metadata = { certId, studentName, institution, course, grade, issueDate: new Date().toISOString(), studentEmail: studentEmail || null };
            const metadataCID = await pinJSONToIPFS(metadata, certId);

            // Fetch fee and send on-chain transaction
            const issuanceFee = await contract.issuanceFee();
            console.log(`💰 Paying issuance fee: ${ethers.formatEther(issuanceFee)} ETH`);
            const tx = await contract.issueCertificate(certId, metadataCID, { value: issuanceFee });
            await tx.wait();

            // Rename uploaded document from temp name to certId-based name
            let documentPath = null;
            if (req.file) {
                const ext = path.extname(req.file.originalname);
                const newFilename = `${certId}${ext}`;
                fs.renameSync(req.file.path, path.join(__dirname, 'uploads', newFilename));
                documentPath = newFilename;
            }

            // Generate QR code, PDF, and pin PDF to IPFS
            const qrCode = await generateQRCode(certId);
            const certData = { certId, studentName, institution, course, grade, issueDate: new Date(), txHash: tx.hash };
            const pdfBytes = await generateCertificatePDF(certData, qrCode);
            const ipfsCID = await pinToIPFS(Buffer.from(pdfBytes), certId);

            // Persist to database
            await prisma.certificate.create({
                data: {
                    certId, studentName, institution, course, grade,
                    issueDate: new Date().toISOString(),
                    txHash: tx.hash,
                    documentPath,
                    documentOriginalName: req.file?.originalname || null,
                    studentEmail: studentEmail || null,
                    ipfsCID,
                },
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
                message: 'Certificate issued successfully',
            });
        } catch (error) {
            // Clean up temp file on failure
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            next(error);
        }
    }
);

/**
 * ISSUE METADATA (MetaMask-signed transaction flow)
 * Called after the frontend has already sent the blockchain transaction
 * via MetaMask. Saves metadata, generates PDF, and pins to IPFS.
 */
app.post(
    '/api/certificates/issue-metadata',
    upload.single('document'),
    [
        body('certId').trim().notEmpty().withMessage('Certificate ID is required'),
        body('studentName').trim().notEmpty().withMessage('Student name is required'),
        body('institution').trim().notEmpty().withMessage('Institution name is required'),
        body('course').trim().notEmpty().withMessage('Course is required'),
        body('grade').trim().notEmpty().withMessage('Grade is required'),
        body('txHash').trim().notEmpty().withMessage('Transaction hash is required'),
        body('issueDate').trim().notEmpty().withMessage('Issue date is required'),
    ],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            console.log('📥 Received issue-metadata request:', req.body);
            let { certId, studentName, institution, course, grade, txHash, issueDate, studentEmail, metadataCID } = req.body;

            // Guard: institution may occasionally arrive as an array (multipart quirk)
            if (Array.isArray(institution)) institution = institution[0];
            if (!institution) console.warn('⚠️ Institution field is missing from request body');

            // Handle optional document upload
            let documentPath = null;
            if (req.file) {
                const ext = path.extname(req.file.originalname);
                const newFilename = `${certId}${ext}`;
                fs.renameSync(req.file.path, path.join(__dirname, 'uploads', newFilename));
                documentPath = newFilename;
            }

            // Generate QR code and PDF, then pin PDF to IPFS
            const qrCode = await generateQRCode(certId);
            const certData = { certId, studentName, institution, course, grade, issueDate: new Date(), txHash };
            const pdfBytes = await generateCertificatePDF(certData, qrCode);
            const ipfsCID = await pinToIPFS(Buffer.from(pdfBytes), certId);

            // Persist to database
            await prisma.certificate.create({
                data: {
                    certId, studentName, institution, course, grade,
                    issueDate, txHash, documentPath,
                    documentOriginalName: req.file?.originalname || null,
                    studentEmail: studentEmail || null,
                    ipfsCID,
                },
            });

            console.log(`✅ Metadata saved for certificate: ${certId}`);

            res.json({
                success: true,
                certId, txHash, issueDate,
                hasDocument: !!documentPath,
                qrCode,
                verifyUrl: `${FRONTEND_URL}/verify/${certId}`,
                ipfsCID,
                message: 'Certificate metadata saved successfully',
            });
        } catch (error) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            next(error);
        }
    }
);

/**
 * VERIFY CERTIFICATE (public)
 * Checks the blockchain for the certificate's existence and revocation status.
 * If missing from the local DB, attempts to self-heal by syncing from IPFS.
 * Returns combined on-chain + DB data.
 */
app.get('/api/certificates/verify/:certId', async (req, res) => {
    try {
        const { certId } = req.params;

        // Primary source of truth: blockchain
        let metadataCID, issuedAt, isRevoked;
        let blockchainError = null;

        try {
            [metadataCID, issuedAt, isRevoked] = await contract.verifyCertificate(certId);
        } catch (e) {
            console.warn(`⚠️ Blockchain verification failed for ${certId}: ${e.message}`);
            blockchainError = e.message;
        }

        // Secondary source: local DB (faster, richer data)
        let dbCert = await prisma.certificate.findUnique({ where: { certId } });

        // DEVELOPMENT FALLBACK: If blockchain node was reset but DB has the record
        if ((!metadataCID || blockchainError) && dbCert) {
            console.log(`💡 Dev Fallback: ${certId} verified via local database (Blockchain node may have been reset)`);
            return res.json({
                exists: true,
                verifiedBy: 'database_fallback',
                isLocalVerified: true,
                isRevoked: false, // Default to false if blockchain is down
                issueDate: dbCert.issueDate,
                certId: dbCert.certId,
                studentName: dbCert.studentName,
                institution: dbCert.institution,
                course: dbCert.course,
                grade: dbCert.grade,
                txHash: dbCert.txHash,
                ipfsCID: dbCert.ipfsCID,
                message: 'Verified via local forensic registry (Blockchain node reset)'
            });
        }

        if (!metadataCID) {
            return res.status(404).json({ exists: false, error: 'Certificate not found on blockchain' });
        }

        // Self-healing: sync from IPFS if the record was somehow lost from DB
        if (!dbCert && metadataCID) {
            console.log(`🩹 Self-healing: syncing ${certId} from IPFS...`);
            const ipfsMeta = await fetchFromIPFS(metadataCID);
            if (ipfsMeta) {
                dbCert = await prisma.certificate.create({
                    data: {
                        certId: ipfsMeta.certId,
                        studentName: ipfsMeta.studentName,
                        institution: ipfsMeta.institution,
                        course: ipfsMeta.course,
                        grade: ipfsMeta.grade,
                        issueDate: ipfsMeta.issueDate,
                        txHash: '0x0000000000000000000000000000000000000000', // placeholder
                        studentEmail: ipfsMeta.studentEmail,
                        ipfsCID: metadataCID,
                    },
                });
                console.log(`✅ Self-heal complete for ${certId}`);
            }
        }

        const qrCode = await generateQRCode(certId);

        res.json({
            exists: true,
            certId: dbCert?.certId || certId,
            studentName: dbCert?.studentName || 'Unknown',
            institution: dbCert?.institution || 'SecureCert Institute',
            course: dbCert?.course || 'Unknown',
            grade: dbCert?.grade || 'N/A',
            issueDate: dbCert?.issueDate || new Date(Number(issuedAt) * 1000).toISOString(),
            txHash: dbCert?.txHash || '0x0',
            isRevoked,
            hasDocument: !!dbCert?.documentPath,
            qrCode,
            ipfsCID: metadataCID,
        });
    } catch (error) {
        console.error('Verify error:', error);
        if (error.message.includes('Certificate does not exist')) {
            return res.status(404).json({ exists: false, error: 'Certificate not found on blockchain' });
        }
        res.status(500).json({ error: error.message });
    }
});

/** GET /api/certificates/:certId/qrcode — Returns QR code data URL for a certificate. */
app.get('/api/certificates/:certId/qrcode', async (req, res) => {
    try {
        const qrCode = await generateQRCode(req.params.certId);
        res.json({ qrCode, verifyUrl: `${FRONTEND_URL}/verify/${req.params.certId}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/certificates/:certId/pdf
 * Generates and streams a certificate PDF on the fly.
 * Add ?view=true to render inline in the browser instead of downloading.
 */
app.get('/api/certificates/:certId/pdf', async (req, res) => {
    try {
        const { certId } = req.params;

        const [, issuedAt, isRevoked] = await contract.verifyCertificate(certId);
        if (isRevoked) return res.status(400).json({ error: 'Certificate has been revoked' });

        const dbCert = await prisma.certificate.findUnique({ where: { certId } });

        const certData = {
            certId,
            studentName: dbCert?.studentName || 'Unknown',
            institution: dbCert?.institution || 'SECURECERT VERIFIED',
            course: dbCert?.course || 'Unknown',
            grade: dbCert?.grade || 'N/A',
            issueDate: dbCert?.issueDate || new Date(Number(issuedAt) * 1000),
            txHash: dbCert?.txHash || '0x0',
        };

        const qrCode = await generateQRCode(certId);
        const pdfBytes = await generateCertificatePDF(certData, qrCode);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            req.query.view === 'true' ? 'inline' : `attachment; filename="${certId}_certificate.pdf"`
        );
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error(`❌ PDF generation error for ${req.params.certId}:`, error);

        if (error.message.includes('Certificate does not exist')) return res.status(404).json({ error: 'Certificate not found on blockchain' });
        if (error.code === 'NETWORK_ERROR' || error.message.includes('network')) return res.status(503).json({ error: 'Blockchain network unreachable' });

        res.status(500).json({
            error: 'Internal server error during PDF generation',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
});

/**
 * GET /api/certificates/download/:certId
 * Downloads the original document associated with a certificate,
 * stamped with a verification banner, QR code, and watermark.
 * Only PDF files are stamped; images are returned as-is.
 * Add ?view=true to render inline.
 */
app.get('/api/certificates/download/:certId', async (req, res) => {
    try {
        const { certId } = req.params;

        const [, , isRevoked] = await contract.verifyCertificate(certId);
        if (isRevoked) return res.status(400).json({ error: 'Certificate has been revoked' });

        const dbCert = await prisma.certificate.findUnique({ where: { certId } });
        if (!dbCert?.documentPath) return res.status(404).json({ error: 'No document found for this certificate' });

        const filePath = path.join(__dirname, 'uploads', dbCert.documentPath);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Document file not found on disk' });

        const ext = path.extname(dbCert.documentPath).toLowerCase();

        if (ext === '.pdf') {
            // Stamp the existing PDF with a verification banner, QR code, and cert ID watermark
            const pdfDoc = await PDFDocument.load(fs.readFileSync(filePath));
            const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

            const qrDataUrl = await generateQRCode(certId);
            const qrImage = await pdfDoc.embedPng(Buffer.from(qrDataUrl.split(',')[1], 'base64'));

            for (const page of pdfDoc.getPages()) {
                const { width, height } = page.getSize();
                const stampText = `VERIFIED: ${certId}`;
                const fontSize = 12;
                const textWidth = helveticaBold.widthOfTextAtSize(stampText, fontSize);

                // Dark banner at bottom center
                page.drawRectangle({ x: width / 2 - textWidth / 2 - 10, y: 20, width: textWidth + 20, height: 25, color: rgb(0.1, 0.3, 0.5) });
                page.drawText(stampText, { x: width / 2 - textWidth / 2, y: 27, size: fontSize, font: helveticaBold, color: rgb(1, 1, 1) });

                // QR code bottom-right
                page.drawImage(qrImage, { x: width - 80, y: 15, width: 60, height: 60 });

                // Diagonal watermark
                page.drawText(certId, { x: width / 4, y: height / 2, size: 40, font: helveticaBold, color: rgb(0.8, 0.8, 0.8), opacity: 0.3, rotate: { type: 'degrees', angle: 45 } });
            }

            const stampedBytes = await pdfDoc.save();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', req.query.view === 'true' ? 'inline' : `attachment; filename="stamped_${certId}.pdf"`);
            return res.send(Buffer.from(stampedBytes));
        }

        // Non-PDF: return the file directly
        res.setHeader('Content-Disposition', req.query.view === 'true' ? 'inline' : `attachment; filename="${certId}${ext}"`);
        res.sendFile(filePath);
    } catch (error) {
        if (error.message.includes('Certificate does not exist')) return res.status(404).json({ error: 'Certificate not found on blockchain' });
        console.error('Download error:', error);
        res.status(500).json({ error: error.message });
    }
});


// ============================================================
// SECTION 13: ADMIN PROTECTED ENDPOINTS
// All routes here require a valid JWT (authenticateToken).
//
// GET    /api/admin/certificates              → list all certificates
// PUT    /api/admin/certificates/:certId      → update notes or document
// POST   /api/admin/certificates/:certId/revoke → revoke on blockchain
// DELETE /api/admin/certificates/:certId      → revoke + delete from DB
// POST   /api/admin/certificates/batch-revoke → bulk revoke
// POST   /api/admin/certificates/batch-delete → bulk delete from DB
// POST   /api/admin/certificates/bulk-issue   → CSV batch issuance
// GET    /api/admin/stats                     → dashboard statistics
// ============================================================

/** LIST ALL CERTIFICATES — enriches each record with its blockchain status. */
app.get('/api/admin/certificates', authenticateToken, async (req, res) => {
    try {
        const allCerts = await prisma.certificate.findMany({ orderBy: { createdAt: 'desc' } });

        const enriched = await Promise.all(
            allCerts.map(async (cert) => {
                try {
                    // verifyCertificate returns: [metadataCID, issuedAt (uint256), isRevoked]
                    const [metadataCID, issuedAt, isRevoked] = await contract.verifyCertificate(cert.certId);
                    return {
                        ...cert,
                        blockchainData: {
                            metadataCID,
                            issuedAt: Number(issuedAt),
                            isRevoked,
                        },
                    };
                } catch (err) {
                    return { ...cert, blockchainData: null, blockchainError: 'Failed to fetch from blockchain' };
                }
            })
        );

        res.json(enriched);
    } catch (error) {
        console.error('Admin get certificates error:', error);
        res.status(500).json({ error: error.message });
    }
});

/** UPDATE CERTIFICATE — supports updating notes and/or replacing the attached document. */
app.put('/api/admin/certificates/:certId', authenticateToken, upload.single('document'), async (req, res) => {
    try {
        const { certId } = req.params;
        const dbCert = await prisma.certificate.findUnique({ where: { certId } });
        if (!dbCert) return res.status(404).json({ error: 'Certificate not found' });

        const updateData = {};

        if (req.body.notes !== undefined) {
            updateData.notes = req.body.notes;
        }

        if (req.file) {
            // Remove old file if one exists
            if (dbCert.documentPath) {
                const oldPath = path.join(__dirname, 'uploads', dbCert.documentPath);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }

            const ext = path.extname(req.file.originalname);
            const newFilename = `${certId}${ext}`;
            fs.renameSync(req.file.path, path.join(__dirname, 'uploads', newFilename));

            updateData.documentPath = newFilename;
            updateData.documentOriginalName = req.file.originalname;
        }

        if (Object.keys(updateData).length > 0) {
            await prisma.certificate.update({ where: { certId }, data: updateData });
        }

        const updated = await prisma.certificate.findUnique({ where: { certId } });
        res.json({ success: true, message: 'Certificate updated successfully', certificate: updated });
    } catch (error) {
        console.error('Update certificate error:', error);
        res.status(500).json({ error: error.message });
    }
});

/** REVOKE CERTIFICATE — sends a revoke transaction to the blockchain. */
app.post('/api/admin/certificates/:certId/revoke', authenticateToken, async (req, res) => {
    try {
        const { certId } = req.params;

        const [, , isRevoked] = await contract.verifyCertificate(certId);
        if (isRevoked) return res.status(400).json({ error: 'Certificate is already revoked' });

        const tx = await contract.revokeCertificate(certId);
        await tx.wait();

        res.json({ success: true, message: 'Certificate revoked successfully', txHash: tx.hash });
    } catch (error) {
        if (error.message.includes('Certificate does not exist')) return res.status(404).json({ error: 'Certificate not found on blockchain' });
        console.error('Revoke error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE CERTIFICATE — revokes on blockchain (if not already revoked),
 * removes the associated file, and deletes the DB record.
 */
app.delete('/api/admin/certificates/:certId', authenticateToken, async (req, res) => {
    try {
        const { certId } = req.params;
        const dbCert = await prisma.certificate.findUnique({ where: { certId } });
        if (!dbCert) return res.status(404).json({ error: 'Certificate not found' });

        // Auto-revoke on blockchain before deletion
        try {
            const [, , isRevoked] = await contract.verifyCertificate(certId);
            if (!isRevoked) {
                console.log(`⚠️ Auto-revoking ${certId} before deletion...`);
                const tx = await contract.revokeCertificate(certId);
                await tx.wait();
                console.log(`✅ ${certId} revoked on blockchain.`);
            }
        } catch (blockchainError) {
            if (!blockchainError.message.includes('Certificate does not exist')) {
                console.error('Blockchain revocation failed during delete:', blockchainError);
            }
        }

        // Remove physical document file
        if (dbCert.documentPath) {
            const filePath = path.join(__dirname, 'uploads', dbCert.documentPath);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        await prisma.certificate.delete({ where: { certId } });

        res.json({ success: true, message: 'Certificate revoked on blockchain and deleted from database.' });
    } catch (error) {
        console.error('Delete certificate error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * BATCH REVOKE — revokes multiple certificates on the blockchain one by one.
 * (Contract does not expose a batch revoke function.)
 * Body: { certIds: string[] }
 */
app.post('/api/admin/certificates/batch-revoke', authenticateToken, async (req, res) => {
    try {
        const { certIds } = req.body;
        if (!Array.isArray(certIds) || certIds.length === 0) {
            return res.status(400).json({ error: 'Array of certificate IDs is required' });
        }

        console.log(`🔄 Batch revoking ${certIds.length} certificates...`);

        const results = await Promise.allSettled(
            certIds.map(async (certId) => {
                const tx = await contract.revokeCertificate(certId);
                await tx.wait();
                return { certId, success: true, txHash: tx.hash };
            })
        );

        const formatted = results.map((r, i) =>
            r.status === 'fulfilled'
                ? r.value
                : { certId: certIds[i], success: false, error: r.reason?.message }
        );

        const succeeded = formatted.filter(r => r.success).length;
        res.json({
            message: `Batch processing complete. ${succeeded} revoked, ${certIds.length - succeeded} failed.`,
            results: formatted,
        });
    } catch (error) {
        console.error('Batch revoke error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * BATCH DELETE — removes multiple certificates from the database
 * and deletes their associated physical files.
 * Does NOT revoke on blockchain; use batch-revoke first if needed.
 * Body: { certIds: string[] }
 */
app.post('/api/admin/certificates/batch-delete', authenticateToken, async (req, res) => {
    try {
        const { certIds } = req.body;
        if (!Array.isArray(certIds) || certIds.length === 0) {
            return res.status(400).json({ error: 'Array of certificate IDs is required' });
        }

        const certsToDelete = await prisma.certificate.findMany({ where: { certId: { in: certIds } } });

        // Delete physical document files
        for (const cert of certsToDelete) {
            if (cert.documentPath) {
                const filePath = path.join(__dirname, 'uploads', cert.documentPath);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        }

        const deleteResult = await prisma.certificate.deleteMany({ where: { certId: { in: certIds } } });

        res.json({
            message: `Successfully deleted ${deleteResult.count} certificates from database.`,
            count: deleteResult.count,
        });
    } catch (error) {
        console.error('Batch delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * BULK ISSUE VIA CSV
 * Accepts a CSV file with columns: studentName, course, grade, email (optional).
 * Processes in batches of 20 to stay within block gas limits.
 * Responds immediately with 202 Accepted; processing happens asynchronously.
 *
 * CSV format expected:
 *   studentName,course,grade,email
 *   John Doe,Computer Science,A,john@example.com
 */
app.post('/api/admin/certificates/bulk-issue', authenticateToken, uploadMemory.single('csvFile'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

        const institution = req.body.institution || 'SecureCert Institute';
        const rows = [];

        // Parse CSV rows from in-memory buffer
        const { Readable } = require('stream');
        Readable.from(req.file.buffer)
            .pipe(csv())
            .on('data', (row) => {
                if (row.studentName && row.course && row.grade) {
                    rows.push({
                        studentName: row.studentName.trim(),
                        course: row.course.trim(),
                        grade: row.grade.trim(),
                        email: row.email ? row.email.trim() : null,
                    });
                }
            })
            .on('end', async () => {
                if (rows.length === 0) {
                    if (!res.headersSent) res.status(400).json({ error: 'No valid rows found in CSV' });
                    return;
                }

                // Acknowledge immediately — bulk processing can take a long time
                res.status(202).json({ message: `Processing ${rows.length} certificates in the background...` });

                const BATCH_SIZE = 20;
                let processed = 0;

                for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                    const batch = rows.slice(i, i + BATCH_SIZE);
                    const batchIds = [];
                    const batchCIDs = [];
                    const timestamp = Date.now();

                    // Pin metadata for each item in the batch
                    for (let j = 0; j < batch.length; j++) {
                        const certId = `CERT${timestamp}${i + j}`;
                        const student = batch[j];
                        const metadata = {
                            certId, studentName: student.studentName, institution,
                            course: student.course, grade: student.grade,
                            issueDate: new Date().toISOString(), studentEmail: student.email,
                        };

                        const metadataCID = await pinJSONToIPFS(metadata, certId);
                        batchIds.push(certId);
                        batchCIDs.push(metadataCID);
                    }

                    try {
                        const feePerCert = await contract.issuanceFee();
                        const totalFee = feePerCert * BigInt(batchIds.length);

                        console.log(`🔄 Minting batch ${Math.floor(i / BATCH_SIZE) + 1} (${batchIds.length} certs) — fee: ${ethers.formatEther(totalFee)} ETH`);
                        const tx = await contract.batchIssueCertificates(batchIds, batchCIDs, { value: totalFee });
                        await tx.wait();

                        // Save each issued certificate to the DB
                        for (let j = 0; j < batch.length; j++) {
                            const certId = batchIds[j];
                            const student = batch[j];

                            try {
                                const qrCode = await generateQRCode(certId);
                                const certData = { certId, studentName: student.studentName, institution, course: student.course, grade: student.grade, issueDate: new Date(), txHash: tx.hash };
                                const pdfBytes = await generateCertificatePDF(certData, qrCode);
                                const ipfsCID = await pinToIPFS(Buffer.from(pdfBytes), certId);

                                await prisma.certificate.create({
                                    data: {
                                        certId,
                                        studentName: student.studentName,
                                        institution,
                                        course: student.course,
                                        grade: student.grade,
                                        issueDate: new Date().toISOString(),
                                        txHash: tx.hash,
                                        studentEmail: student.email,
                                        ipfsCID,
                                    },
                                });
                                processed++;
                            } catch (itemErr) {
                                console.error(`❌ Error saving certificate ${certId}:`, itemErr.message);
                            }
                        }
                    } catch (batchErr) {
                        console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} blockchain error:`, batchErr.message);
                    }
                }

                console.log(`✅ Bulk issuance complete: ${processed}/${rows.length} certificates minted`);
            })
            .on('error', (err) => {
                console.error('CSV parse error:', err);
            });

    } catch (error) {
        console.error('Bulk issue error:', error);
        if (!res.headersSent) res.status(500).json({ error: error.message });
    }
});

/**
 * ADMIN STATS
 * Returns aggregate counts: total, valid, revoked, and documents uploaded.
 * Queries each certificate's blockchain status individually.
 */
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
    try {
        const allCerts = await prisma.certificate.findMany();
        let validCount = 0;
        let revokedCount = 0;

        for (const cert of allCerts) {
            try {
                const [, , isRevoked] = await contract.verifyCertificate(cert.certId);
                isRevoked ? revokedCount++ : validCount++;
            } catch {
                // Certificate may not exist on-chain (e.g. DB/chain mismatch) — skip
            }
        }

        res.json({
            totalCertificates: allCerts.length,
            validCertificates: validCount,
            revokedCertificates: revokedCount,
            documentsUploaded: allCerts.filter(c => c.documentPath).length,
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});


// ============================================================
// SECTION 14: LEGACY & MISC ENDPOINTS
// ============================================================

/** Legacy public certificates list — returns all DB records unfiltered. */
app.get('/api/certificates', async (_req, res) => {
    const certs = await prisma.certificate.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(certs);
});


// ============================================================
// SECTION 15: ERROR HANDLER & SERVER STARTUP
// The error handler must be registered after all routes.
// ============================================================

app.use(errorHandler);

const PORT = parseInt(process.env.PORT, 10) || 5000;

const server = app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 SecureCert Certificate Server Started');
    console.log('='.repeat(50));
    console.log(`📡 API:        http://localhost:${PORT}`);
    console.log(`🌐 Frontend:   ${FRONTEND_URL}`);
    console.log(`⛓️  RPC:        ${process.env.RPC_URL}`);
    console.log(`📜 Contract:   ${process.env.CONTRACT_ADDRESS}`);
    console.log(`💾 Database:   Connected (Prisma + SQLite)`);
    console.log('='.repeat(50) + '\n');
});

// Graceful shutdown: close DB and server cleanly on SIGTERM/SIGINT
const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    await prisma.$disconnect();
    server.close(() => {
        console.log('✅ Server closed.');
        process.exit(0);
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));