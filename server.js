const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// Use node-fetch if global fetch is not available (for Node < 18)
if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

// --- Telegram Configuration ---
const TELEGRAM_TOKEN = '6116875730:AAGU9dOB62VyiZGe0Zc4PogJJcxv74IBB1w';
const TELEGRAM_CHAT_ID = '1680454327';
const DB_BACKUP_TAG = "###JAFAR_DB_BACKUP###";

let db = {
    users: {},    // username -> { role, avatar, isMuted, tag }
    messages: []  // Array of last 50 messages
};

// --- Persistent Database Handling ---
async function persistData(logMsg = null) {
    try {
        fs.writeFileSync('database.json', JSON.stringify(db, null, 2));
    } catch (e) { console.error("Local Save Error:", e); }

    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_BOT_TOKEN') return;

    let textToSend = logMsg || `${DB_BACKUP_TAG}\n<code>${JSON.stringify({
        users: db.users,
        messages: db.messages.slice(-10)
    })}</code>`;

    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: textToSend,
                parse_mode: 'HTML'
            })
        });
        console.log("☁️ Telegram Sync Successful");
    } catch (e) {
        console.error("❌ Telegram Sync Failed:", e);
    }
}

async function loadFromCloud() {
    if (fs.existsSync('database.json')) {
        try {
            db = JSON.parse(fs.readFileSync('database.json', 'utf8'));
            console.log("📂 Loaded from local DB");
        } catch (e) { }
    }

    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_BOT_TOKEN') return;

    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=-1&limit=5`);
        const data = await response.json();
        const updates = data.result || [];
        const backupMsg = [...updates].reverse().find(u => u.message && u.message.text && u.message.text.includes(DB_BACKUP_TAG));

        if (backupMsg) {
            const jsonPart = backupMsg.message.text.split(DB_BACKUP_TAG)[1].trim();
            const cloudData = JSON.parse(jsonPart);
            db.users = cloudData.users || db.users;
            db.messages = cloudData.messages || db.messages;
            console.log("✅ Restored from Telegram Cloud");
        }
    } catch (e) {
        console.error("❌ Cloud Load Failed:", e);
    }
}

loadFromCloud();

const activeSockets = {};

io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, userData }) => {
        socket.join(roomId);
        const username = userData.username;
        if (!username) return;

        activeSockets[socket.id] = username;

        if (!db.users[username]) {
            const isFirst = Object.keys(db.users).length === 0;
            db.users[username] = {
                username: username,
                avatar: userData.avatar,
                tag: userData.tag || '#0000',
                role: isFirst ? 'owner' : 'member',
                isMuted: false
            };
            persistData(`👤 <b>مستخدم جديد:</b> ${username} (#${userData.tag})`);
        }

        socket.emit('load-chat-history', db.messages);
        syncMembers();
    });

    socket.on('send-message', ({ roomId, messageData }) => {
        const username = activeSockets[socket.id];
        const user = db.users[username];

        if (user && !user.isMuted) {
            const fullMsg = {
                ...messageData,
                username: user.username,
                avatar: user.avatar,
                role: user.role,
                isAdmin: user.role === 'owner'
            };
            db.messages.push(fullMsg);
            if (db.messages.length > 50) db.messages.shift();

            io.to(roomId).emit('new-message', fullMsg);
            persistData(`💬 <b>${user.username}:</b> ${messageData.text || '[Image]'}`);
        } else if (user && user.isMuted) {
            socket.emit('error-msg', 'أنت مكتوم حالياً.');
        }
    });

    socket.on('mute-user', (targetName) => {
        const admin = db.users[activeSockets[socket.id]];
        if (admin?.role === 'owner' && db.users[targetName]) {
            db.users[targetName].isMuted = !db.users[targetName].isMuted;
            persistData(`🚫 <b>${admin.username}</b> قام بتمكين/تعطيل كتم <b>${targetName}</b>`);
            syncMembers();
        }
    });

    socket.on('assign-role', ({ targetName, role }) => {
        const admin = db.users[activeSockets[socket.id]];
        if (admin?.role === 'owner' && db.users[targetName]) {
            db.users[targetName].role = role;
            persistData(`🛡️ <b>${admin.username}</b> غير رتبة <b>${targetName}</b> إلى ${role}`);
            syncMembers();
        }
    });

    socket.on('kick-user', (targetName) => {
        const admin = db.users[activeSockets[socket.id]];
        if (admin?.role === 'owner') {
            const sid = Object.keys(activeSockets).find(id => activeSockets[id] === targetName);
            if (sid) {
                io.to(sid).emit('kicked');
                io.sockets.sockets.get(sid)?.disconnect();
                persistData(`🔨 <b>${admin.username}</b> طرد <b>${targetName}</b>`);
            }
        }
    });

    socket.on('disconnect', () => {
        delete activeSockets[socket.id];
        syncMembers();
    });

    function syncMembers() {
        const list = Object.values(db.users).map(u => ({
            ...u,
            isOnline: Object.values(activeSockets).includes(u.username)
        }));
        io.emit('update-member-list', list);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 JafarCord Server Running on port ${PORT}`);
    persistData("🚀 <b>السيرفر بدأ العمل والربط سليم!</b>");
});
