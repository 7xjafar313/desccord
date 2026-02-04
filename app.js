document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const chatInput = document.getElementById('chatInput');
    const messagesContainer = document.getElementById('messagesContainer');
    const memberList = document.getElementById('memberList');
    const memberCount = document.getElementById('memberCount');
    const authOverlay = document.getElementById('authOverlay');
    const loginCard = document.getElementById('loginCard');
    const registerCard = document.getElementById('registerCard');
    const showRegister = document.getElementById('showRegister');
    const showLogin = document.getElementById('showLogin');

    // --- State ---
    let currentUser = JSON.parse(localStorage.getItem('jafarcord_user')) || {
        username: '',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + Math.random(),
        tag: '#' + Math.floor(1000 + Math.random() * 9000)
    };

    let socket = null;
    let currentTextChannel = 'عام';

    const initConnection = () => {
        if (!socket) {
            socket = io();
        }

        socket.on('load-chat-history', (history) => {
            messagesContainer.innerHTML = '';
            history.forEach(renderMessage);
        });

        socket.on('update-member-list', (users) => {
            const me = users.find(u => u.username === currentUser.username);
            if (me) {
                currentUser.isAdmin = me.role === 'owner';
                currentUser.role = me.role;
                currentUser.isMuted = me.isMuted;
            }
            renderMemberList(users);
        });

        socket.on('new-message', renderMessage);
        socket.on('error-msg', (msg) => alert(msg));
        socket.on('kicked', () => {
            alert("تم طردك بواسطة الأدمن.");
            localStorage.clear();
            window.location.reload();
        });

        socket.emit('join-room', { roomId: currentTextChannel, userData: currentUser });
    };

    const renderMemberList = (users) => {
        if (!memberList) return;
        memberList.innerHTML = '';
        const onlineCount = users.filter(u => u.isOnline).length;
        memberCount.innerText = `${onlineCount} متصل / ${users.length} إجمالي`;

        users.forEach(user => {
            const div = document.createElement('div');
            div.className = `member-item ${user.isOnline ? '' : 'offline'}`;
            if (!user.isOnline) div.style.opacity = '0.4';

            const roleClass = `role-${user.role}`;
            const muteIcon = user.isMuted ? '<i class="fa-solid fa-microphone-slash mute-indicator"></i>' : '';
            const adminIcon = user.role === 'owner' ? '<i class="fa-solid fa-crown admin-badge"></i>' : '';

            let actionsHtml = '';
            if (currentUser.isAdmin && user.username !== currentUser.username) {
                actionsHtml = `
                    <div class="member-actions-popup">
                        <div class="action-item" onclick="window.emitAction('mute-user', '${user.username}')">${user.isMuted ? 'إلغاء الكتم' : 'كتم'}</div>
                        <div class="action-item" onclick="window.emitAction('assign-role', {targetName: '${user.username}', role: 'mod'})">ترقية لمشرف</div>
                        <div class="action-item" onclick="window.emitAction('assign-role', {targetName: '${user.username}', role: 'member'})">عضو عادي</div>
                        <div class="action-item danger" onclick="window.emitAction('kick-user', '${user.username}')">طرد</div>
                    </div>
                `;
            }

            div.innerHTML = `
                <img src="${user.avatar}" class="member-avatar-mini">
                <div class="member-name ${roleClass}">
                    ${user.username} ${adminIcon} ${muteIcon}
                </div>
                ${actionsHtml}
            `;
            memberList.appendChild(div);
        });
    };

    window.emitAction = (event, data) => {
        socket.emit(event, data);
    };

    const renderMessage = (data) => {
        const div = document.createElement('div');
        div.className = 'message';
        const roleLabel = data.role === 'owner' ? '[أدمن]' : (data.role === 'mod' ? '[مشرف]' : '');
        div.innerHTML = `
            <img src="${data.avatar}" class="message-avatar">
            <div class="message-content">
                <div class="message-header"><span class="message-user role-${data.role}">${data.username} <small>${roleLabel}</small></span><span class="message-time">${data.time}</span></div>
                <div class="message-text">${data.text}</div>
            </div>
        `;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const handleLogin = (name) => {
        currentUser.username = name;
        localStorage.setItem('jafarcord_user', JSON.stringify(currentUser));
        if (authOverlay) authOverlay.style.display = 'none';
        document.body.classList.remove('auth-mode');
        initConnection();
    };

    // Auto-login if session exists
    if (currentUser.username) {
        handleLogin(currentUser.username);
    }

    // Auth Switching
    if (showRegister) {
        showRegister.addEventListener('click', (e) => {
            e.preventDefault();
            loginCard.style.display = 'none';
            registerCard.style.display = 'block';
        });
    }

    if (showLogin) {
        showLogin.addEventListener('click', (e) => {
            e.preventDefault();
            registerCard.style.display = 'none';
            loginCard.style.display = 'block';
        });
    }

    document.getElementById('loginForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const u = document.getElementById('loginEmail').value;
        if (u) handleLogin(u);
    });

    document.getElementById('registerForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const u = document.getElementById('regUsername').value;
        if (u) handleLogin(u);
    });

    chatInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && chatInput.value.trim() !== '') {
            socket.emit('send-message', {
                roomId: currentTextChannel,
                messageData: {
                    text: chatInput.value,
                    time: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
                    channel: currentTextChannel
                }
            });
            chatInput.value = '';
        }
    });

    document.getElementById('menuBtn')?.onclick = () => document.getElementById('channelSidebar').classList.toggle('open');
});
