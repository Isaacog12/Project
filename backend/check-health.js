const http = require('http');

const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/ready', // check the ready endpoint to see if DB and Blockchain are connected
    method: 'GET',
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log(`BODY: ${data}`);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();
