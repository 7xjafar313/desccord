const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

// --- Telegram Database Configuration ---
// يرجى وضع معلوماتك هنا ليعمل النظام السحابي
const TELEGRAM_TOKEN = '6116875730:AAGU9dOB62VyiZGe0Zc4PogJJcxv74IBB1w';
const TELEGRAM_CHAT_ID = '1680454327';
const DB_BACKUP_TAG = "###JAFAR_DB_BACKUP###";

let db = {
    users: {},    // username -> { role, avatar, isMuted, tag }
    messages: []  // Array of last 50 messages
};

// --- Helper: Save to Telegram (Cloud) & Local File (Backup) ---
async function persistData() {
    // 1. Save locally
    fs.writeFileSync('database.json', JSON.stringify(db, null, 2));

    // 2. Save to Telegram Cloud
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_BOT_TOKEN') return;

    const payload = {
        users: db.users,
        messages: db.messages.slice(-20) // نكتفي بآخر 20 رسالة للسحابة لتقليل الحجم
    };

    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: `${DB_BACKUP_TAG}\n<code>${JSON.stringify(payload)}</code>`,
                parse_mode: 'HTML'
            })
        });
        console.log("☁️ تم تحديث النسخة السحابية في تيليجرام");
    } catch (e) {
        console.error("❌ فشل الاتصال بتيليجرام للتخزين:", e);
    }
}

// --- Helper: Load from Telegram Cloud ---
async function loadFromCloud() {
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_BOT_TOKEN') {
        // Fallback to local file if no Telegram info
        if (fs.existsSync('database.json')) {
            db = JSON.parse(fs.readFileSync('database.json', 'utf8'));
            console.log("📂 تم تحميل البيانات من الملف المحلي");
        }
        return;
    }

    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=-1&limit=10`);
        const data = await response.json();

        // البحث عن آخر رسالة تحتوي على التاج الخاص بنا
        const updates = data.result || [];
        const backupMsg = updates.reverse().find(u => u.message && u.message.text && u.message.text.includes(DB_BACKUP_TAG));

        if (backupMsg) {
            const jsonPart = backupMsg.message.text.split(DB_BACKUP_TAG)[1].trim();
            const cloudData = JSON.parse(jsonPart);
            db.users = cloudData.users || {};
            db.messages = cloudData.messages || [];
            console.log("✅ تم استعادة البيانات بنجاح من سحابة تيليجرام");
        } else {
            console.log("⚠️ لم يتم العثور على نسخة سحابية مؤخراً، سيتم استخدام الملف المحلي.");
            if (fs.existsSync('database.json')) {
                db = JSON.parse(fs.readFileSync('database.json', 'utf8'));
            }
        }
    } catch (e) {
        console.error("❌ خطأ أثناء تحميل البيانات من السحابة:", e);
        if (fs.existsSync('database.json')) {
            db = JSON.parse(fs.readFileSync('database.json', 'utf8'));
        }
    }
}

// Initial Load
loadFromCloud();

const activeSockets = {}; // socket.id -> username

io.on('connection', (socket) => {

    socket.on('join-room', ({ roomId, userData }) => {
        socket.join(roomId);
        const username = userData.username;
        activeSockets[socket.id] = username;

        if (!db.users[username]) {
            const isFirst = Object.keys(db.users).length === 0;
            db.users[username] = {
                username: username,
                avatar: userData.avatar,
                tag: userData.tag,
                role: isFirst ? 'owner' : 'member',
                isMuted: false
            };
            persistData(); // حفظ العضو الجديد سحابياً
        }

        socket.emit('load-chat-history', db.messages);
        syncMembers();
    });

    socket.on('send-message', ({ roomId, messageData }) => {
        const username = activeSockets[socket.id];
        const user = db.users[username];

        if (user && !user.isMuted) {
            const fullMsg = { ...messageData, role: user.role, isAdmin: user.role === 'owner' };
            db.messages.push(fullMsg);
            if (db.messages.length > 50) db.messages.shift();

            io.to(roomId).emit('new-message', fullMsg);
            persistData(); // حفظ الرسالة والنشاط سحابياً
        } else if (user && user.isMuted) {
            socket.emit('error-msg', 'أنت مكتوم ولا يمكنك الإرسال.');
        }
    });

    // Admin Actions
    socket.on('mute-user', (targetName) => {
        const admin = db.users[activeSockets[socket.id]];
        if (admin?.role === 'owner' && db.users[targetName]) {
            db.users[targetName].isMuted = !db.users[targetName].isMuted;
            persistData();
            syncMembers();
        }
    });

    socket.on('assign-role', ({ targetName, role }) => {
        const admin = db.users[activeSockets[socket.id]];
        if (admin?.role === 'owner' && db.users[targetName]) {
            db.users[targetName].role = role;
            persistData();
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
server.listen(PORT, () => console.log(`🚀 JafarCord Cloud-Sync Server on port ${PORT}`));
