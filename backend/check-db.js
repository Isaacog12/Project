const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'certificates.db');
const db = new Database(dbPath);

console.log('--- Database: ' + dbPath + ' ---');

// List tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('\n--- Tables ---');
console.table(tables);

// Query certificates
if (tables.find(t => t.name === 'certificates')) {
    console.log('\n--- Certificates Table ---');
    const rows = db.prepare('SELECT * FROM certificates').all();
    if (rows.length === 0) {
        console.log('No certificates found.');
    } else {
        console.table(rows);
    }
}
