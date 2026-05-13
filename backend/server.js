'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const { ethers } = require('ethers');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');
const csv = require('csv-parser');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');


// ============================================================
// SECTION 1: ENVIRONMENT VALIDATION
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
    process.exit(1);
}

// Warn about weak JWT secret in production
if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET must be at least 32 characters in production.');
    process.exit(1);
}

console.log('✅ Environment variables validated');

const FRONTEND_URL = process.env.FRONTEND_URL;
const IS_PROD = process.env.NODE_ENV === 'production';


// ============================================================
// SECTION 2: EXPRESS APP SETUP
// ============================================================

const app = express();

app.use((req, _res, next) => {
    console.log(`[PRE-CORS] ${req.method} ${req.path} from ${req.headers.origin || 'unknown origin'}`);
    next();
});

// CORS: tighter in production — allow only the configured frontend origin
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (origin === FRONTEND_URL) return callback(null, true);
        callback(new Error(`CORS policy: origin "${origin}" not allowed`));
    },
    credentials: true,
    optionsSuccessStatus: 200,
}));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
        },
    },
    // Add HSTS in production
    hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// General limiter
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
});

// Auth limiter — stricter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts, please try again later.' },
    skipSuccessfulRequests: true,
    skip: (req) => req.method === 'OPTIONS',
});

// Issuance limiter — prevents spam-minting
const issuanceLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    message: { error: 'Certificate issuance rate limit reached. Please try again later.' },
    skip: (req) => req.method === 'OPTIONS',
});

app.use('/api/', limiter);

app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});


// ============================================================
// SECTION 3: DATABASE SETUP
// ============================================================

const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const rawDb = new Database(dbUrl.replace('file:', ''));

// Enable WAL mode for better concurrent read performance with SQLite
rawDb.pragma('journal_mode = WAL');
rawDb.pragma('foreign_keys = ON');

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

console.log('✅ Prisma Client initialized with better-sqlite3 adapter (WAL mode)');


// ============================================================
// SECTION 4: IPFS HELPERS (Pinata)
// ============================================================

/**
 * Pins a PDF buffer to IPFS via Pinata.
 * @param {Buffer} pdfBuffer
 * @param {string} certId
 * @returns {Promise<string|null>} IPFS CID or null on failure
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

        const response = await axios.post(
            'https://api.pinata.cloud/pinning/pinFileToIPFS',
            formData,
            {
                maxBodyLength: Infinity,
                timeout: 30_000,
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
                    'pinata_api_key': PINATA_API_KEY,
                    'pinata_secret_api_key': PINATA_SECRET_API_KEY,
                },
            }
        );

        console.log(`📌 Pinned PDF ${certId} to IPFS: ${response.data.IpfsHash}`);
        return response.data.IpfsHash;
    } catch (error) {
        console.error('❌ IPFS PDF pinning failed:', error.response?.data || error.message);
        return null;
    }
}

/**
 * Pins a JSON metadata object to IPFS via Pinata.
 * @param {object} metadata
 * @param {string} certId
 * @returns {Promise<string|null>} IPFS CID or null on failure
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
                timeout: 15_000,
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
 * Fetches a JSON object from IPFS via the Pinata gateway.
 * @param {string} cid
 * @returns {Promise<object|null>}
 */
async function fetchFromIPFS(cid) {
    if (!cid || cid.startsWith('mock-')) return null;

    // Validate CID format (basic check: CIDv0 starts with Qm, CIDv1 is longer)
    if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58,})$/.test(cid)) {
        console.warn(`⚠️ Skipping IPFS fetch: invalid CID format "${cid}"`);
        return null;
    }

    try {
        const response = await axios.get(
            `https://gateway.pinata.cloud/ipfs/${cid}`,
            { timeout: 8_000 }
        );
        return response.data;
    } catch (error) {
        console.error(`❌ Failed to fetch from IPFS (${cid}):`, error.message);
        return null;
    }
}


// ============================================================
// SECTION 5: FILE UPLOAD SETUP (Multer)
// ============================================================

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CACHE_DIR = path.join(UPLOADS_DIR, 'cache');
[UPLOADS_DIR, CACHE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/**
 * Validates a file's magic bytes to confirm the declared MIME type.
 * Prevents extension-spoofing attacks.
 */
async function validateFileMagicBytes(filePath, mimetype) {
    const handle = await fsp.open(filePath, 'r');
    const buffer = Buffer.alloc(8);
    await handle.read(buffer, 0, 8, 0);
    await handle.close();

    const hex = buffer.toString('hex').toUpperCase();

    if (mimetype === 'application/pdf' && hex.startsWith('255044462D')) return true; // %PDF-
    if (mimetype === 'image/png' && hex.startsWith('89504E47')) return true;          // PNG
    if (mimetype === 'image/jpeg' && (hex.startsWith('FFD8FF'))) return true;          // JPEG

    return false;
}

const diskStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
        // Use a cryptographically random name to prevent path traversal or collisions
        const randomName = crypto.randomBytes(16).toString('hex');
        cb(null, `tmp_${randomName}${path.extname(file.originalname).toLowerCase()}`);
    },
});

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

/** Disk-backed multer for document uploads (PDF/PNG/JPEG, max 10 MB). */
const upload = multer({
    storage: diskStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_MIME_TYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
            cb(null, true);
        } else {
            cb(Object.assign(new Error('Only PDF, PNG, and JPEG files are allowed'), { status: 400 }));
        }
    },
});

/** In-memory multer for CSV bulk import. */
const uploadMemory = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB cap for CSVs
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || path.extname(file.originalname).toLowerCase() === '.csv') {
            cb(null, true);
        } else {
            cb(Object.assign(new Error('Only CSV files are accepted for bulk import'), { status: 400 }));
        }
    },
});

/** Safely removes a file, suppressing errors if it doesn't exist. */
async function safeUnlink(filePath) {
    try { await fsp.unlink(filePath); } catch { /* ignore */ }
}


// ============================================================
// SECTION 6: BLOCKCHAIN SETUP
// ============================================================

const fetchReq = new ethers.FetchRequest(process.env.RPC_URL);
fetchReq.timeout = 120_000;

const provider = new ethers.JsonRpcProvider(
    fetchReq,
    undefined,
    { staticNetwork: true }
);

const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const CONTRACT_ABI = [
    'function issueCertificate(string certId, string metadataCID) external payable',
    'function batchIssueCertificates(string[] certIds, string[] metadataCIDs) external payable',
    'function verifyCertificate(string certId) external view returns (string, uint256, bool)',
    'function batchVerifyCertificates(string[] certIds) external view returns (string[], uint256[], bool[])',
    'function revokeCertificate(string certId)',
    'function issuanceFee() external view returns (uint256)',
];

const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

const CHAIN_BATCH_SIZE = 150;

/**
 * Verifies certificates in chunked batches to stay within RPC payload limits.
 */
async function batchVerifyCertificatesChunked(certIds) {
    if (certIds.length === 0) return [[], [], []];

    const metadataCIDs = [];
    const issuedAts = [];
    const isRevokedStatuses = [];

    for (let i = 0; i < certIds.length; i += CHAIN_BATCH_SIZE) {
        const slice = certIds.slice(i, i + CHAIN_BATCH_SIZE);
        const [m, t, r] = await contract.batchVerifyCertificates(slice);
        metadataCIDs.push(...m);
        issuedAts.push(...t);
        isRevokedStatuses.push(...r);
    }

    return [metadataCIDs, issuedAts, isRevokedStatuses];
}

/**
 * Normalises a raw grade string into a consistent chart label.
 */
function chartGradeLabel(grade) {
    const g = String(grade || '');
    if (g.includes('First Class')) return 'First Class';
    if (g.includes('Upper')) return 'Second Class Upper';
    if (g.includes('Lower')) return 'Second Class Lower';
    if (g.includes('Third')) return 'Third Class';
    if (g.includes('Pass')) return 'Pass';
    return g || 'Other';
}

/**
 * Runs async tasks with a fixed concurrency ceiling.
 * @template T, R
 * @param {number} concurrency
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function asyncPool(concurrency, items, fn) {
    if (items.length === 0) return [];
    const results = new Array(items.length);
    let nextIndex = 0;
    const worker = async () => {
        while (true) {
            const i = nextIndex++;
            if (i >= items.length) break;
            results[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}


// ============================================================
// SECTION 7: ASSET PRELOADING
// ============================================================

const logoBuffers = {};

(async () => {
    try {
        const assetsDir = path.join(__dirname, 'assets');
        if (!fs.existsSync(assetsDir)) {
            console.warn('⚠️ Assets directory not found — logos will be skipped');
            return;
        }
        for (const idx of [1, 2]) {
            const logoPath = path.join(assetsDir, `logo${idx}.jpg`);
            if (fs.existsSync(logoPath)) logoBuffers[idx] = await fsp.readFile(logoPath);
        }
        console.log('✅ Asset preloading complete');
    } catch (error) {
        console.error('❌ Error preloading assets:', error.message);
    }
})();


// ============================================================
// SECTION 8: CERTIFICATE HELPERS
// ============================================================

/**
 * Generates a QR code data URL encoding the public verification URL.
 * @param {string} certId
 * @returns {Promise<string>} base64 PNG data URL
 */
async function generateQRCode(certId) {
    return QRCode.toDataURL(`${FRONTEND_URL}/verify/${encodeURIComponent(certId)}`, {
        width: 200,
        margin: 2,
        color: { dark: '#1a365d', light: '#ffffff' },
    });
}

/**
 * Returns the stored QR code for a cert, or generates and persists one.
 * @param {string} certId
 * @param {object|null} dbCert
 * @returns {Promise<string>} QR code data URL
 */
async function resolveOrPersistQrCode(certId, dbCert) {
    if (dbCert?.qrCode) return dbCert.qrCode;

    const qr = await generateQRCode(certId);

    if (dbCert?.certId) {
        prisma.certificate
            .update({ where: { certId: dbCert.certId }, data: { qrCode: qr } })
            .catch(e => console.warn(`Could not persist QR for ${certId}:`, e.message));
    }

    return qr;
}

/**
 * Generates a styled A4-landscape certificate PDF.
 * Results are cached to disk for subsequent downloads.
 *
 * @param {object} certData
 * @param {string} qrCodeDataUrl
 * @returns {Promise<Buffer>}
 */
async function generateCertificatePDF(certData, qrCodeDataUrl) {
    const cachePath = path.join(CACHE_DIR, `${certData.certId}_cert.pdf`);

    try {
        await fsp.access(cachePath);
        return fsp.readFile(cachePath);
    } catch {
        // Cache miss — generate below
    }

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([842, 595]); // A4 Landscape (points)
    const { width, height } = page.getSize();

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

    const Green = rgb(0.04, 0.29, 0.20);
    const goldColor = rgb(0.72, 0.53, 0.04);
    const darkGray = rgb(0.2, 0.2, 0.2);

    // Try to load an institution-specific logo
    let logoImage = null;
    try {
        const assetsDir = path.join(__dirname, 'assets');
        for (const ext of ['.png', '.jpg', '.jpeg']) {
            const logoPath = path.join(assetsDir, `${certData.institution}${ext}`);
            try {
                await fsp.access(logoPath);
                const logoBytes = await fsp.readFile(logoPath);
                logoImage = ext === '.png'
                    ? await pdfDoc.embedPng(logoBytes)
                    : await pdfDoc.embedJpg(logoBytes);
                break;
            } catch { /* try next extension */ }
        }
    } catch (error) {
        console.warn(`⚠️ Could not load logo for "${certData.institution}":`, error.message);
    }

    // Background watermark
    if (logoImage) {
        try {
            const ar = logoImage.width / logoImage.height;
            const wh = height * 0.5;
            page.drawImage(logoImage, {
                x: width / 2 - (wh * ar) / 2,
                y: height / 2 - wh / 2,
                width: wh * ar,
                height: wh,
                opacity: 0.05,
            });
        } catch (e) {
            console.error('Error drawing background watermark:', e.message);
        }
    }

    // Decorative borders
    const margin = 30, innerMargin = 45;
    page.drawRectangle({ x: margin, y: margin, width: width - margin * 2, height: height - margin * 2, borderColor: goldColor, borderWidth: 3 });
    page.drawRectangle({ x: innerMargin, y: innerMargin, width: width - innerMargin * 2, height: height - innerMargin * 2, borderColor: Green, borderWidth: 2 });

    // Corner ornaments
    const ornSize = 15, ornOffset = 38;
    [
        { x: ornOffset, y: height - ornOffset },
        { x: width - ornOffset - ornSize, y: height - ornOffset },
        { x: ornOffset, y: ornOffset },
        { x: width - ornOffset - ornSize, y: ornOffset },
    ].forEach(({ x, y }) => {
        page.drawRectangle({ x, y, width: ornSize, height: ornSize, color: goldColor });
        page.drawRectangle({ x: x + 3, y: y - 3, width: ornSize - 6, height: ornSize - 6, color: Green });
    });

    // Header logo
    if (logoImage) {
        try {
            const ar = logoImage.width / logoImage.height;
            const lh = 70;
            page.drawImage(logoImage, { x: width / 2 - (lh * ar) / 2, y: height - 120, width: lh * ar, height: lh });
        } catch (e) {
            console.error('Error drawing header logo:', e.message);
        }
    }

    // Institution name
    const institutionText = String(certData.institution || 'SECURECERT VERIFIED').toUpperCase();
    const instSize = 18;
    page.drawText(institutionText, {
        x: width / 2 - timesBold.widthOfTextAtSize(institutionText, instSize) / 2,
        y: height - 135,
        size: instSize,
        font: timesBold,
        color: Green,
    });
    page.drawLine({ start: { x: width / 2 - 100, y: height - 145 }, end: { x: width / 2 + 100, y: height - 145 }, thickness: 1, color: goldColor });

    // Award title
    const titleText = 'AWARD OF EXCELLENCE';
    const titleSize = 32;
    const titleW = timesBold.widthOfTextAtSize(titleText, titleSize);
    page.drawText(titleText, { x: width / 2 - titleW / 2, y: height - 200, size: titleSize, font: timesBold, color: Green });

    const titleLineY = height - 210;
    page.drawLine({ start: { x: width / 2 - titleW / 2 - 30, y: titleLineY }, end: { x: width / 2 - titleW / 2 - 10, y: titleLineY }, thickness: 2, color: goldColor });
    page.drawLine({ start: { x: width / 2 + titleW / 2 + 10, y: titleLineY }, end: { x: width / 2 + titleW / 2 + 30, y: titleLineY }, thickness: 2, color: goldColor });

    const certifyText = 'This is to certify that';
    page.drawText(certifyText, {
        x: width / 2 - timesItalic.widthOfTextAtSize(certifyText, 14) / 2,
        y: height - 250,
        size: 14,
        font: timesItalic,
        color: darkGray,
    });

    // Student name
    const studentText = certData.studentName.toUpperCase();
    const studentSize = 28;
    const studentW = timesBold.widthOfTextAtSize(studentText, studentSize);
    page.drawText(studentText, { x: width / 2 - studentW / 2, y: height - 290, size: studentSize, font: timesBold, color: rgb(0.5, 0.1, 0.1) });
    page.drawLine({ start: { x: width / 2 - studentW / 2 - 20, y: height - 298 }, end: { x: width / 2 + studentW / 2 + 20, y: height - 298 }, thickness: 1.5, color: goldColor });

    const achieveText = 'has successfully completed the requirements for';
    page.drawText(achieveText, { x: width / 2 - helvetica.widthOfTextAtSize(achieveText, 12) / 2, y: height - 330, size: 12, font: helvetica, color: darkGray });

    // Course
    const courseSize = 22;
    page.drawText(certData.course, { x: width / 2 - timesBold.widthOfTextAtSize(certData.course, courseSize) / 2, y: height - 365, size: courseSize, font: timesBold, color: Green });

    // Grade
    const gradeText = `with a grade of ${certData.grade}`;
    page.drawText(gradeText, { x: width / 2 - helveticaBold.widthOfTextAtSize(gradeText, 14) / 2, y: height - 395, size: 14, font: helveticaBold, color: rgb(0, 0.6, 0.3) });

    // Issue date
    const issueDate = new Date(certData.issueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const dateText = `Issued on ${issueDate}`;
    page.drawText(dateText, { x: width / 2 - helvetica.widthOfTextAtSize(dateText, 11) / 2, y: 180, size: 11, font: helvetica, color: darkGray });

    // Registrar signature line
    const sigY = 130;
    page.drawLine({ start: { x: width / 2 - 120, y: sigY }, end: { x: width / 2 + 120, y: sigY }, thickness: 1, color: darkGray });
    const sigTitle = 'Registrar, SecureCert';
    page.drawText(sigTitle, { x: width / 2 - helvetica.widthOfTextAtSize(sigTitle, 10) / 2, y: sigY - 15, size: 10, font: helvetica, color: darkGray });

    // Official seal
    const sealX = 100, sealY = 100;
    page.drawCircle({ x: sealX, y: sealY, size: 35, borderColor: goldColor, borderWidth: 3 });
    page.drawCircle({ x: sealX, y: sealY, size: 27, borderColor: Green, borderWidth: 2 });
    page.drawText('OFFICIAL', { x: sealX - 20, y: sealY + 5, size: 8, font: helveticaBold, color: Green });
    page.drawText('SEAL', { x: sealX - 12, y: sealY - 5, size: 8, font: helveticaBold, color: Green });

    // QR code
    if (qrCodeDataUrl) {
        const qrBytes = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
        const qrImage = await pdfDoc.embedPng(qrBytes);
        page.drawImage(qrImage, { x: width - 140, y: 70, width: 70, height: 70 });
        page.drawText('Scan to Verify', { x: width - 135, y: 60, size: 7, font: helvetica, color: darkGray });
    }

    // Blockchain info block
    page.drawText('BLOCKCHAIN SECURED', { x: 60, y: 60, size: 8, font: helveticaBold, color: Green });
    page.drawText(`Certificate No: ${certData.certId}`, { x: 60, y: 48, size: 7, font: helvetica, color: darkGray });
    if (certData.txHash) {
        page.drawText(`TX: ${certData.txHash.substring(0, 30)}...`, { x: 60, y: 38, size: 6, font: helvetica, color: rgb(0.6, 0.6, 0.6) });
    }

    // Verification stamp
    const stampText = `VERIFIED: ${certData.certId}`;
    const stampSize = 12;
    const stampW = helveticaBold.widthOfTextAtSize(stampText, stampSize);
    page.drawRectangle({ x: width / 2 - stampW / 2 - 10, y: 20, width: stampW + 20, height: 25, color: rgb(0, 0, 0) });
    page.drawText(stampText, { x: width / 2 - stampW / 2, y: 27, size: stampSize, font: helveticaBold, color: rgb(1, 1, 1) });

    // Diagonal watermark
    const wmSize = 40;
    page.drawText(certData.certId, {
        x: width / 2 - helveticaBold.widthOfTextAtSize(certData.certId, wmSize) / 2,
        y: height / 2,
        size: wmSize,
        font: helveticaBold,
        color: rgb(0.8, 0.8, 0.8),
        opacity: 0.3,
        rotate: { type: 'degrees', angle: 45 },
    });

    const pdfBytes = await pdfDoc.save();
    await fsp.writeFile(cachePath, pdfBytes);
    return pdfBytes;
}


// ============================================================
// SECTION 9: MIDDLEWARE
// ============================================================

/** Responds 400 with structured field errors if express-validator found issues. */
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

/** Verifies the Bearer JWT in the Authorization header. */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access token required' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            const message = err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
            return res.status(403).json({ error: message });
        }
        req.user = user;
        next();
    });
};

/**
 * Central error handler — must be registered last.
 * Sanitises error details in production.
 */
const errorHandler = (err, req, res, _next) => {
    console.error('Unhandled error:', err);

    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Maximum size is 10 MB.' });
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }

    const status = err.status || 500;
    res.status(status).json({
        error: err.message || 'Internal server error',
        ...(IS_PROD ? {} : { stack: err.stack }),
    });
};


// ============================================================
// SECTION 10: HEALTH CHECK ENDPOINTS
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
            contract: process.env.CONTRACT_ADDRESS,
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

        // Use timing-safe comparison to prevent timing attacks
        const usernameMatch = crypto.timingSafeEqual(
            Buffer.from(username),
            Buffer.from(process.env.ADMIN_USERNAME)
        );
        const passwordMatch = crypto.timingSafeEqual(
            Buffer.from(password),
            Buffer.from(process.env.ADMIN_PASSWORD)
        );

        if (usernameMatch && passwordMatch) {
            const token = jwt.sign(
                { username, role: 'admin' },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );
            console.log(`✅ Admin login successful: ${username}`);
            return res.json({ success: true, token, user: { username, role: 'admin' } });
        }

        console.warn(`❌ Failed login attempt for: ${username}`);
        // Introduce a small artificial delay to further blunt brute-force attempts
        setTimeout(() => res.status(401).json({ error: 'Invalid credentials' }), 300);
    }
);

app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});


// ============================================================
// SECTION 12: PUBLIC CERTIFICATE ENDPOINTS
// ============================================================

/**
 * PIN METADATA
 * Pins certificate metadata to IPFS for MetaMask pre-issuance flow.
 */
app.post(
    '/api/certificates/pin-metadata',
    [
        body('studentName').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Student name must be 2–100 characters'),
        body('institution').trim().notEmpty().isLength({ min: 2, max: 150 }).withMessage('Institution must be 2–150 characters'),
        body('course').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Course must be 2–100 characters'),
        body('grade').trim().notEmpty().isLength({ min: 1, max: 50 }).withMessage('Grade must be 1–50 characters'),
        body('studentEmail').optional().isEmail().normalizeEmail().withMessage('Invalid email address'),
    ],
    handleValidationErrors,
    async (req, res, next) => {
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
                studentEmail: studentEmail || null,
            };

            const metadataCID = await pinJSONToIPFS(metadata, certId);
            if (!metadataCID) {
                return res.status(502).json({ error: 'Failed to pin metadata to IPFS. Please try again.' });
            }

            res.json({ success: true, certId, metadataCID, metadata });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * ISSUE CERTIFICATE (server-signed transaction)
 * Pins metadata, pays fee, sends TX, generates PDF, saves to DB.
 */
app.post(
    '/api/certificates/issue',
    issuanceLimiter,
    upload.single('document'),
    [
        body('studentName').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Student name must be 2–100 characters'),
        body('institution').trim().notEmpty().isLength({ min: 2, max: 150 }).withMessage('Institution must be 2–150 characters'),
        body('course').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Course must be 2–100 characters'),
        body('grade').trim().notEmpty().isLength({ min: 1, max: 50 }).withMessage('Grade must be 1–50 characters'),
        body('studentEmail').optional().isEmail().normalizeEmail().withMessage('Invalid email address'),
    ],
    handleValidationErrors,
    async (req, res, next) => {
        let tempFilePath = req.file?.path || null;
        try {
            const { studentName, institution, course, grade, studentEmail } = req.body;
            const certId = `CERT${Date.now()}`;

            console.log(`📝 Issuing certificate for: ${studentName}`);

            // Validate uploaded file's actual contents (not just MIME type)
            if (req.file) {
                const isValid = await validateFileMagicBytes(req.file.path, req.file.mimetype);
                if (!isValid) {
                    await safeUnlink(req.file.path);
                    return res.status(400).json({ error: 'Uploaded file contents do not match the declared file type.' });
                }
            }

            const metadata = { certId, studentName, institution, course, grade, issueDate: new Date().toISOString(), studentEmail: studentEmail || null };
            const metadataCID = await pinJSONToIPFS(metadata, certId);
            if (!metadataCID) {
                return res.status(502).json({ error: 'Failed to pin metadata to IPFS. Please try again.' });
            }

            const issuanceFee = await contract.issuanceFee();
            const tx = await contract.issueCertificate(certId, metadataCID, { value: issuanceFee });
            await tx.wait();

            // Rename temp file to cert-ID-based name
            let documentPath = null;
            if (req.file) {
                const ext = path.extname(req.file.originalname).toLowerCase();
                const newFilename = `${certId}${ext}`;
                await fsp.rename(req.file.path, path.join(UPLOADS_DIR, newFilename));
                tempFilePath = null; // no longer temp
                documentPath = newFilename;
            }

            const qrCode = await generateQRCode(certId);
            const certData = { certId, studentName, institution, course, grade, issueDate: new Date(), txHash: tx.hash };
            const pdfBytes = await generateCertificatePDF(certData, qrCode);
            const ipfsCID = await pinToIPFS(Buffer.from(pdfBytes), certId);

            await prisma.certificate.create({
                data: {
                    certId, studentName, institution, course, grade,
                    issueDate: new Date().toISOString(),
                    txHash: tx.hash,
                    documentPath,
                    documentOriginalName: req.file?.originalname || null,
                    studentEmail: studentEmail || null,
                    ipfsCID,
                    qrCode,
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
            if (tempFilePath) await safeUnlink(tempFilePath);
            next(error);
        }
    }
);

/**
 * ISSUE METADATA (MetaMask-signed transaction)
 * Saves metadata, generates PDF, and pins to IPFS after a frontend TX.
 */
app.post(
    '/api/certificates/issue-metadata',
    upload.single('document'),
    [
        body('certId').trim().notEmpty().withMessage('Certificate ID is required'),
        body('studentName').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Student name is required'),
        body('institution').trim().notEmpty().isLength({ min: 2, max: 150 }).withMessage('Institution is required'),
        body('course').trim().notEmpty().isLength({ min: 2, max: 100 }).withMessage('Course is required'),
        body('grade').trim().notEmpty().isLength({ min: 1, max: 50 }).withMessage('Grade is required'),
        body('txHash').trim().notEmpty().matches(/^0x[0-9a-fA-F]{64}$/).withMessage('txHash must be a valid 32-byte hex string'),
        body('issueDate').trim().notEmpty().isISO8601().withMessage('issueDate must be a valid ISO 8601 date'),
        body('studentEmail').optional().isEmail().normalizeEmail().withMessage('Invalid email address'),
    ],
    handleValidationErrors,
    async (req, res, next) => {
        let tempFilePath = req.file?.path || null;
        try {
            let { certId, studentName, institution, course, grade, txHash, issueDate, studentEmail, metadataCID } = req.body;

            // Guard against array values from multipart quirks
            if (Array.isArray(institution)) institution = institution[0];
            if (!institution) return res.status(400).json({ error: 'institution is required' });

            // Validate file magic bytes
            if (req.file) {
                const isValid = await validateFileMagicBytes(req.file.path, req.file.mimetype);
                if (!isValid) {
                    await safeUnlink(req.file.path);
                    return res.status(400).json({ error: 'Uploaded file contents do not match the declared file type.' });
                }
            }

            // Check for duplicate certId before doing any expensive work
            const existing = await prisma.certificate.findUnique({ where: { certId } });
            if (existing) {
                return res.status(409).json({ error: 'A certificate with this ID already exists.' });
            }

            let documentPath = null;
            if (req.file) {
                const ext = path.extname(req.file.originalname).toLowerCase();
                const newFilename = `${certId}${ext}`;
                await fsp.rename(req.file.path, path.join(UPLOADS_DIR, newFilename));
                tempFilePath = null;
                documentPath = newFilename;
            }

            const qrCode = await generateQRCode(certId);
            const certData = { certId, studentName, institution, course, grade, issueDate: new Date(), txHash };
            const pdfBytes = await generateCertificatePDF(certData, qrCode);
            const ipfsCID = await pinToIPFS(Buffer.from(pdfBytes), certId);

            await prisma.certificate.create({
                data: {
                    certId, studentName, institution, course, grade,
                    issueDate, txHash, documentPath,
                    documentOriginalName: req.file?.originalname || null,
                    studentEmail: studentEmail || null,
                    ipfsCID,
                    qrCode,
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
            if (tempFilePath) await safeUnlink(tempFilePath);
            next(error);
        }
    }
);

/**
 * VERIFY CERTIFICATE (public)
 * Blockchain is the source of truth; falls back to DB if node is down.
 */
app.get(
    '/api/certificates/verify/:certId',
    [param('certId').trim().notEmpty().isLength({ max: 100 }).withMessage('Invalid certificate ID')],
    handleValidationErrors,
    async (req, res) => {
        try {
            const { certId } = req.params;

            let metadataCID, issuedAt, isRevoked;
            let blockchainError = null;

            try {
                [metadataCID, issuedAt, isRevoked] = await contract.verifyCertificate(certId);
            } catch (e) {
                console.warn(`⚠️ Blockchain verification failed for ${certId}: ${e.message}`);
                blockchainError = e.message;
            }

            const dbCert = await prisma.certificate.findUnique({ where: { certId } });

            // Dev / node-reset fallback
            if ((!metadataCID || blockchainError) && dbCert) {
                console.log(`💡 Dev Fallback: ${certId} verified via local database`);
                return res.json({
                    exists: true,
                    verifiedBy: 'database_fallback',
                    isLocalVerified: true,
                    isRevoked: false,
                    issueDate: dbCert.issueDate,
                    certId: dbCert.certId,
                    studentName: dbCert.studentName,
                    institution: dbCert.institution,
                    course: dbCert.course,
                    grade: dbCert.grade,
                    txHash: dbCert.txHash,
                    ipfsCID: dbCert.ipfsCID,
                    qrCode: dbCert.qrCode || null,
                    message: 'Verified via local forensic registry (Blockchain node reset)',
                });
            }

            if (!metadataCID) {
                return res.status(404).json({ exists: false, error: 'Certificate not found on blockchain' });
            }

            // Self-healing: if DB row is missing, try to restore from IPFS
            let syncedDbCert = dbCert;
            if (!dbCert && metadataCID) {
                console.log(`🩹 Self-healing: syncing ${certId} from IPFS...`);
                const ipfsMeta = await fetchFromIPFS(metadataCID);
                if (ipfsMeta) {
                    try {
                        syncedDbCert = await prisma.certificate.create({
                            data: {
                                certId: ipfsMeta.certId,
                                studentName: ipfsMeta.studentName,
                                institution: ipfsMeta.institution || 'Unknown',
                                course: ipfsMeta.course,
                                grade: ipfsMeta.grade,
                                issueDate: ipfsMeta.issueDate,
                                txHash: '0x0000000000000000000000000000000000000000',
                                studentEmail: ipfsMeta.studentEmail || null,
                                ipfsCID: metadataCID,
                            },
                        });
                        console.log(`✅ Self-heal complete for ${certId}`);
                    } catch (dbErr) {
                        console.warn(`⚠️ Self-heal DB write failed for ${certId}:`, dbErr.message);
                    }
                }
            }

            res.json({
                exists: true,
                certId: syncedDbCert?.certId || certId,
                studentName: syncedDbCert?.studentName || 'Unknown',
                institution: syncedDbCert?.institution || 'SecureCert Institute',
                course: syncedDbCert?.course || 'Unknown',
                grade: syncedDbCert?.grade || 'N/A',
                issueDate: syncedDbCert?.issueDate || new Date(Number(issuedAt) * 1000).toISOString(),
                txHash: syncedDbCert?.txHash || '0x0',
                isRevoked,
                hasDocument: !!syncedDbCert?.documentPath,
                ipfsCID: metadataCID,
            });
        } catch (error) {
            console.error('Verify error:', error);
            if (error.message?.includes('Certificate does not exist')) {
                return res.status(404).json({ exists: false, error: 'Certificate not found on blockchain' });
            }
            res.status(500).json({ error: error.message });
        }
    }
);

/** GET /api/certificates/:certId/qrcode — Returns QR code data URL. */
app.get(
    '/api/certificates/:certId/qrcode',
    [param('certId').trim().notEmpty().isLength({ max: 100 })],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const { certId } = req.params;
            const dbCert = await prisma.certificate.findUnique({ where: { certId } });
            if (!dbCert) return res.status(404).json({ error: 'Certificate not found' });

            const qrCode = await resolveOrPersistQrCode(certId, dbCert);
            res.json({ qrCode, verifyUrl: `${FRONTEND_URL}/verify/${certId}` });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * GET /api/certificates/:certId/pdf — Streams a generated certificate PDF.
 * Add ?view=true to render inline.
 */
app.get(
    '/api/certificates/:certId/pdf',
    [param('certId').trim().notEmpty().isLength({ max: 100 })],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const { certId } = req.params;

            let isRevoked = false;
            try {
                [, , isRevoked] = await contract.verifyCertificate(certId);
            } catch (e) {
                // If blockchain is unreachable, proceed — DB may have the data
                console.warn(`⚠️ Could not check revocation for ${certId}: ${e.message}`);
            }

            if (isRevoked) return res.status(400).json({ error: 'Certificate has been revoked' });

            const dbCert = await prisma.certificate.findUnique({ where: { certId } });
            if (!dbCert) return res.status(404).json({ error: 'Certificate not found' });

            const certData = {
                certId,
                studentName: dbCert.studentName,
                institution: dbCert.institution,
                course: dbCert.course,
                grade: dbCert.grade,
                issueDate: dbCert.issueDate,
                txHash: dbCert.txHash,
            };

            const qrCode = await resolveOrPersistQrCode(certId, dbCert);
            const pdfBytes = await generateCertificatePDF(certData, qrCode);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader(
                'Content-Disposition',
                req.query.view === 'true'
                    ? 'inline'
                    : `attachment; filename="${encodeURIComponent(certId)}_certificate.pdf"`
            );
            res.send(Buffer.from(pdfBytes));
        } catch (error) {
            if (error.message?.includes('Certificate does not exist')) {
                return res.status(404).json({ error: 'Certificate not found on blockchain' });
            }
            next(error);
        }
    }
);

/**
 * GET /api/certificates/download/:certId
 * Downloads the original document, stamped with a verification banner & QR.
 */
app.get(
    '/api/certificates/download/:certId',
    [param('certId').trim().notEmpty().isLength({ max: 100 })],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const { certId } = req.params;

            let isRevoked = false;
            try {
                [, , isRevoked] = await contract.verifyCertificate(certId);
            } catch (e) {
                console.warn(`⚠️ Could not check revocation for ${certId}: ${e.message}`);
            }

            if (isRevoked) return res.status(400).json({ error: 'Certificate has been revoked' });

            const dbCert = await prisma.certificate.findUnique({ where: { certId } });
            if (!dbCert?.documentPath) return res.status(404).json({ error: 'No document found for this certificate' });

            const filePath = path.join(UPLOADS_DIR, dbCert.documentPath);

            // Guard against path traversal
            if (!filePath.startsWith(UPLOADS_DIR)) {
                return res.status(400).json({ error: 'Invalid document path' });
            }

            try {
                await fsp.access(filePath);
            } catch {
                return res.status(404).json({ error: 'Document file not found on disk' });
            }

            const ext = path.extname(dbCert.documentPath).toLowerCase();

            if (ext === '.pdf') {
                const pdfDoc = await PDFDocument.load(await fsp.readFile(filePath));
                const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
                const qrDataUrl = await resolveOrPersistQrCode(certId, dbCert);
                const qrImage = await pdfDoc.embedPng(Buffer.from(qrDataUrl.split(',')[1], 'base64'));

                for (const page of pdfDoc.getPages()) {
                    const { width, height } = page.getSize();
                    const stampText = `VERIFIED: ${certId}`;
                    const fontSize = 12;
                    const textWidth = helveticaBold.widthOfTextAtSize(stampText, fontSize);

                    page.drawRectangle({ x: width / 2 - textWidth / 2 - 10, y: 20, width: textWidth + 20, height: 25, color: rgb(0.1, 0.3, 0.5) });
                    page.drawText(stampText, { x: width / 2 - textWidth / 2, y: 27, size: fontSize, font: helveticaBold, color: rgb(1, 1, 1) });
                    page.drawImage(qrImage, { x: width - 80, y: 15, width: 60, height: 60 });
                    page.drawText(certId, { x: width / 4, y: height / 2, size: 40, font: helveticaBold, color: rgb(0.8, 0.8, 0.8), opacity: 0.3, rotate: { type: 'degrees', angle: 45 } });
                }

                const stampedBytes = await pdfDoc.save();
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader(
                    'Content-Disposition',
                    req.query.view === 'true' ? 'inline' : `attachment; filename="${encodeURIComponent(certId)}_stamped.pdf"`
                );
                return res.send(Buffer.from(stampedBytes));
            }

            // Non-PDF: send the file directly
            res.setHeader(
                'Content-Disposition',
                req.query.view === 'true' ? 'inline' : `attachment; filename="${encodeURIComponent(certId)}${ext}"`
            );
            res.sendFile(filePath);
        } catch (error) {
            if (error.message?.includes('Certificate does not exist')) {
                return res.status(404).json({ error: 'Certificate not found on blockchain' });
            }
            next(error);
        }
    }
);


// ============================================================
// SECTION 13: ADMIN PROTECTED ENDPOINTS
// ============================================================

/**
 * LIST CERTIFICATES (paginated, searchable)
 * Enriches page results with batched blockchain verification.
 */
app.get(
    '/api/admin/certificates',
    authenticateToken,
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('pageSize').optional().isInt({ min: 1, max: 200 }).toInt(),
        query('search').optional().isLength({ max: 200 }).trim().escape(),
    ],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const page = req.query.page || 1;
            const pageSize = req.query.pageSize || 50;
            const search = req.query.search || '';

            const where = search
                ? {
                    OR: [
                        { certId: { contains: search } },
                        { studentName: { contains: search } },
                        { institution: { contains: search } },
                        { course: { contains: search } },
                        { grade: { contains: search } },
                    ],
                }
                : {};

            const [total, pageCerts] = await Promise.all([
                prisma.certificate.count({ where }),
                prisma.certificate.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                }),
            ]);

            let blockchainDataMap = {};
            if (pageCerts.length > 0) {
                try {
                    const certIds = pageCerts.map(c => c.certId);
                    const [metadataCIDs, issuedAts, isRevokedStatuses] = await batchVerifyCertificatesChunked(certIds);
                    certIds.forEach((id, idx) => {
                        blockchainDataMap[id] = {
                            metadataCID: metadataCIDs[idx],
                            issuedAt: Number(issuedAts[idx]),
                            isRevoked: isRevokedStatuses[idx],
                        };
                    });
                } catch (err) {
                    console.warn('⚠️ Batch verification failed:', err.message);
                }
            }

            const items = pageCerts.map(cert => ({
                ...cert,
                blockchainData: blockchainDataMap[cert.certId] || null,
                blockchainError: blockchainDataMap[cert.certId] ? null : 'Blockchain status unavailable',
            }));

            res.json({ items, total, page, pageSize });
        } catch (error) {
            next(error);
        }
    }
);

/** UPDATE CERTIFICATE — update notes or replace attached document. */
app.put(
    '/api/admin/certificates/:certId',
    authenticateToken,
    upload.single('document'),
    [param('certId').trim().notEmpty().isLength({ max: 100 })],
    handleValidationErrors,
    async (req, res, next) => {
        let tempFilePath = req.file?.path || null;
        try {
            const { certId } = req.params;
            const dbCert = await prisma.certificate.findUnique({ where: { certId } });
            if (!dbCert) return res.status(404).json({ error: 'Certificate not found' });

            if (req.file) {
                const isValid = await validateFileMagicBytes(req.file.path, req.file.mimetype);
                if (!isValid) {
                    await safeUnlink(req.file.path);
                    return res.status(400).json({ error: 'Uploaded file contents do not match the declared file type.' });
                }
            }

            const updateData = {};
            if (req.body.notes !== undefined) updateData.notes = req.body.notes;

            if (req.file) {
                if (dbCert.documentPath) {
                    await safeUnlink(path.join(UPLOADS_DIR, dbCert.documentPath));
                }
                const ext = path.extname(req.file.originalname).toLowerCase();
                const newFilename = `${certId}${ext}`;
                await fsp.rename(req.file.path, path.join(UPLOADS_DIR, newFilename));
                tempFilePath = null;
                updateData.documentPath = newFilename;
                updateData.documentOriginalName = req.file.originalname;

                // Invalidate cached PDF since document has changed
                await safeUnlink(path.join(CACHE_DIR, `${certId}_cert.pdf`));
            }

            if (Object.keys(updateData).length > 0) {
                await prisma.certificate.update({ where: { certId }, data: updateData });
            }

            const updated = await prisma.certificate.findUnique({ where: { certId } });
            res.json({ success: true, message: 'Certificate updated successfully', certificate: updated });
        } catch (error) {
            if (tempFilePath) await safeUnlink(tempFilePath);
            next(error);
        }
    }
);

/** REVOKE CERTIFICATE — sends revoke TX to blockchain. */
app.post(
    '/api/admin/certificates/:certId/revoke',
    authenticateToken,
    [param('certId').trim().notEmpty().isLength({ max: 100 })],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const { certId } = req.params;
            const [, , isRevoked] = await contract.verifyCertificate(certId);
            if (isRevoked) return res.status(400).json({ error: 'Certificate is already revoked' });

            const tx = await contract.revokeCertificate(certId);
            await tx.wait();

            res.json({ success: true, message: 'Certificate revoked successfully', txHash: tx.hash });
        } catch (error) {
            if (error.message?.includes('Certificate does not exist')) {
                return res.status(404).json({ error: 'Certificate not found on blockchain' });
            }
            next(error);
        }
    }
);

/**
 * DELETE CERTIFICATE — revokes on-chain, removes file, deletes DB record.
 */
app.delete(
    '/api/admin/certificates/:certId',
    authenticateToken,
    [param('certId').trim().notEmpty().isLength({ max: 100 })],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const { certId } = req.params;
            const dbCert = await prisma.certificate.findUnique({ where: { certId } });
            if (!dbCert) return res.status(404).json({ error: 'Certificate not found' });

            try {
                const [, , isRevoked] = await contract.verifyCertificate(certId);
                if (!isRevoked) {
                    console.log(`⚠️ Auto-revoking ${certId} before deletion...`);
                    const tx = await contract.revokeCertificate(certId);
                    await tx.wait();
                    console.log(`✅ ${certId} revoked on blockchain.`);
                }
            } catch (blockchainError) {
                if (!blockchainError.message?.includes('Certificate does not exist')) {
                    console.error('Blockchain revocation failed during delete:', blockchainError.message);
                }
            }

            if (dbCert.documentPath) await safeUnlink(path.join(UPLOADS_DIR, dbCert.documentPath));
            await safeUnlink(path.join(CACHE_DIR, `${certId}_cert.pdf`));

            await prisma.certificate.delete({ where: { certId } });

            res.json({ success: true, message: 'Certificate revoked and deleted successfully.' });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * BATCH REVOKE — revokes multiple certificates on-chain one by one.
 * Body: { certIds: string[] }
 */
app.post(
    '/api/admin/certificates/batch-revoke',
    authenticateToken,
    [body('certIds').isArray({ min: 1, max: 500 }).withMessage('certIds must be a non-empty array (max 500)')],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const { certIds } = req.body;
            console.log(`🔄 Batch revoking ${certIds.length} certificates...`);

            const results = await asyncPool(3, certIds, async (certId) => {
                try {
                    const tx = await contract.revokeCertificate(certId);
                    await tx.wait();
                    return { certId, success: true, txHash: tx.hash };
                } catch (reason) {
                    return { certId, success: false, error: reason?.message };
                }
            });

            const succeeded = results.filter(r => r.success).length;
            res.json({
                message: `Batch complete: ${succeeded} revoked, ${certIds.length - succeeded} failed.`,
                results,
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * BATCH DELETE — removes records from DB and their files.
 * Body: { certIds: string[] }
 */
app.post(
    '/api/admin/certificates/batch-delete',
    authenticateToken,
    [body('certIds').isArray({ min: 1, max: 500 }).withMessage('certIds must be a non-empty array (max 500)')],
    handleValidationErrors,
    async (req, res, next) => {
        try {
            const { certIds } = req.body;
            const certsToDelete = await prisma.certificate.findMany({ where: { certId: { in: certIds } } });

            await Promise.allSettled(
                certsToDelete.flatMap(cert => [
                    cert.documentPath ? safeUnlink(path.join(UPLOADS_DIR, cert.documentPath)) : Promise.resolve(),
                    safeUnlink(path.join(CACHE_DIR, `${cert.certId}_cert.pdf`)),
                ])
            );

            const deleteResult = await prisma.certificate.deleteMany({ where: { certId: { in: certIds } } });

            res.json({
                message: `Successfully deleted ${deleteResult.count} certificates from database.`,
                count: deleteResult.count,
            });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * BULK ISSUE VIA CSV
 * Accepts a CSV file with columns: studentName, course, grade, email (optional).
 * Processes asynchronously in batches of 20 and responds with 202 immediately.
 *
 * Expected CSV:
 *   studentName,course,grade,email
 *   Jane Doe,Computer Science,First Class,jane@example.com
 */
app.post(
    '/api/admin/certificates/bulk-issue',
    authenticateToken,
    uploadMemory.single('csvFile'),
    [body('institution').optional().trim().isLength({ max: 150 })],
    handleValidationErrors,
    async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

            const institution = req.body.institution?.trim() || 'SecureCert Institute';
            const rows = [];

            const { Readable } = require('stream');
            const parser = Readable.from(req.file.buffer).pipe(csv());

            await new Promise((resolve, reject) => {
                parser
                    .on('data', (row) => {
                        const studentName = row.studentName?.trim();
                        const course = row.course?.trim();
                        const grade = row.grade?.trim();

                        // Validate required fields and reasonable length limits
                        if (
                            studentName && studentName.length <= 100 &&
                            course && course.length <= 100 &&
                            grade && grade.length <= 50
                        ) {
                            rows.push({
                                studentName,
                                course,
                                grade,
                                email: row.email ? row.email.trim() : null,
                            });
                        }
                    })
                    .on('end', resolve)
                    .on('error', reject);
            });

            if (rows.length === 0) {
                return res.status(400).json({ error: 'No valid rows found in CSV' });
            }

            // Limit to prevent runaway jobs
            const MAX_BULK = 1000;
            if (rows.length > MAX_BULK) {
                return res.status(400).json({ error: `CSV exceeds the maximum of ${MAX_BULK} rows per bulk import.` });
            }

            res.status(202).json({ message: `Processing ${rows.length} certificates in the background.` });

            // Async processing after response is sent
            (async () => {
                const BATCH_SIZE = 20;
                let processed = 0;

                for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                    const batch = rows.slice(i, i + BATCH_SIZE);
                    const timestamp = Date.now();

                    const pinTasks = batch.map((student, j) => ({
                        student,
                        j,
                        certId: `CERT${timestamp}${i + j}`,
                    }));

                    const pinResults = await asyncPool(4, pinTasks, async ({ student, certId }) => {
                        const metadata = {
                            certId, studentName: student.studentName, institution,
                            course: student.course, grade: student.grade,
                            issueDate: new Date().toISOString(), studentEmail: student.email,
                        };
                        const cid = await pinJSONToIPFS(metadata, certId);
                        return cid ? { certId, cid, student } : null;
                    });

                    const valid = pinResults.filter(Boolean);
                    if (valid.length === 0) {
                        console.warn(`⚠️ Batch ${Math.floor(i / BATCH_SIZE) + 1}: no successful IPFS pins, skipping`);
                        continue;
                    }

                    try {
                        const feePerCert = await contract.issuanceFee();
                        const totalFee = feePerCert * BigInt(valid.length);
                        const tx = await contract.batchIssueCertificates(
                            valid.map(r => r.certId),
                            valid.map(r => r.cid),
                            { value: totalFee }
                        );
                        await tx.wait();

                        await asyncPool(3, valid, async ({ certId, student }) => {
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
                                        qrCode,
                                    },
                                });
                                processed++;
                            } catch (itemErr) {
                                console.error(`❌ Error processing ${certId}:`, itemErr.message);
                            }
                        });
                    } catch (batchErr) {
                        console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} blockchain error:`, batchErr.message);
                    }
                }

                console.log(`✅ Bulk issuance complete: ${processed}/${rows.length} certificates minted`);
            })();
        } catch (error) {
            console.error('Bulk issue error:', error);
            if (!res.headersSent) res.status(500).json({ error: error.message });
        }
    }
);

/**
 * ADMIN STATS
 * Returns totals: all, valid, revoked, with uploaded documents.
 * Also returns grade and course breakdowns for charts.
 */
app.get('/api/admin/stats', authenticateToken, async (req, res, next) => {
    try {
        const [totalCertificates, documentsUploaded] = await Promise.all([
            prisma.certificate.count(),
            prisma.certificate.count({ where: { documentPath: { not: null } } }),
        ]);

        if (totalCertificates === 0) {
            return res.json({
                totalCertificates: 0,
                validCertificates: 0,
                revokedCertificates: 0,
                documentsUploaded: 0,
                chartGrades: [],
                chartCourses: [],
            });
        }

        let validCount = totalCertificates;
        let revokedCount = 0;

        const idRows = await prisma.certificate.findMany({ select: { certId: true } });
        const certIds = idRows.map(r => r.certId);

        try {
            const [, , isRevokedStatuses] = await batchVerifyCertificatesChunked(certIds);
            revokedCount = isRevokedStatuses.filter(Boolean).length;
            validCount = totalCertificates - revokedCount;
        } catch (err) {
            console.error('Batch stats verification failed:', err.message);
        }

        const [gradeGroups, courseGroups] = await Promise.all([
            prisma.certificate.groupBy({ by: ['grade'], _count: { grade: true } }),
            prisma.certificate.groupBy({ by: ['course'], _count: { course: true }, orderBy: { _count: { course: 'desc' } }, take: 5 }),
        ]);

        const gradeBucket = new Map();
        for (const row of gradeGroups) {
            const label = chartGradeLabel(row.grade);
            gradeBucket.set(label, (gradeBucket.get(label) || 0) + row._count.grade);
        }

        res.json({
            totalCertificates,
            validCertificates: validCount,
            revokedCertificates: revokedCount,
            documentsUploaded,
            chartGrades: [...gradeBucket.entries()].map(([name, value]) => ({ name, value })),
            chartCourses: courseGroups.map(r => ({ name: r.course, value: r._count.course })),
        });
    } catch (error) {
        next(error);
    }
});


// ============================================================
// SECTION 14: LEGACY & MISC ENDPOINTS
// ============================================================

/** Legacy public certificates list — all DB records, unfiltered. */
app.get('/api/certificates', async (_req, res, next) => {
    try {
        const certs = await prisma.certificate.findMany({ orderBy: { createdAt: 'desc' } });
        res.json(certs);
    } catch (error) {
        next(error);
    }
});


// ============================================================
// SECTION 15: ERROR HANDLER & SERVER STARTUP
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
    console.log(`💾 Database:   Connected (Prisma + SQLite, WAL mode)`);
    console.log('='.repeat(50) + '\n');
});

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

// Catch unhandled promise rejections to prevent silent failures
process.on('unhandledRejection', (reason) => {
    console.error('🔥 Unhandled Promise Rejection:', reason);
});