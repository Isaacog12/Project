
const { PrismaClient } = require('@prisma/client');
const Database = require('better-sqlite3');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

async function main() {
    const dbUrl = 'file:./dev.db';
    const adapter = new PrismaBetterSqlite3({ url: dbUrl });
    const prisma = new PrismaClient({ adapter });

    const certs = await prisma.certificate.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' }
    });

    console.log(JSON.stringify(certs, null, 2));
}

main().catch(console.error);
