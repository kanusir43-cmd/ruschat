// ===== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ =====
let currentUser = null;
let ws = null;
let onlineUsers = [];
let servers = new Map();
let currentServerId = 'default-server';
let currentChannelId = 'general';
let channelMessages = new Map();
let dmConversations = new Map();
let currentDMUser = null;

// WebRTC
let peerConnections = new Map();
let localStream = null;
let screenStream = null;
let isInVoiceChannel = false;
let currentVoiceChannel = null;

// UI
let userAvatar = null;
let groups = [];
let groupAvatars = {};

// ===== АУТЕНТИФИКАЦИЯ =====
function isRussianPhone(phone) {
    return phone.startsWith('+7') && phone.length >= 12;
}

function login() {
    const username = document.getElementById('username').value.trim();
    const phone = document.getElementById('phone').value.trim();
    
    if (!username) {
        showNotification('Введите имя пользователя', 'error');
        return;
    }
    
    if (!isRussianPhone(phone)) {
        showNotification('Доступ только для российских номеров (+7)', 'error');
        return;
    }
    
    currentUser = {
        username: username,
        phone: phone,
        id: Date.now()
    };
    
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');
    
    connectWebSocket();
    loadUserData();
}

function logout() {
    if (isInVoiceChannel) {
        leaveVoiceChannel();
    }
    
    if (ws) {
        ws.close();
    }
    
    currentUser = null;
    servers.clear();
    channelMessages.clear();
    
    document.getElementById('chat-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
}


// ===== WEBSOCKET =====
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('✅ WebSocket подключен');
        ws.send(JSON.stringify({
            type: 'auth',
            username: currentUser.username,
            phone: currentUser.phone,
            id: currentUser.id
        }));
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket ошибка:', error);
        showNotification('Ошибка подключения к серверу', 'error');
    };
    
    ws.onclose = () => {
        console.log('❌ WebSocket отключен');
        setTimeout(() => {
            if (currentUser) connectWebSocket();
        }, 3000);
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'authSuccess':
            handleAuthSuccess(data);
            break;
        case 'userList':
            onlineUsers = data.users;
            updateMembersList();
            updateVoiceChannelMembers();
            break;
        case 'message':
            handleMessage(data);
            break;
        case 'serverCreated':
            handleServerCreated(data);
            break;
        case 'channelCreated':
            handleChannelCreated(data);
            break;
        case 'channelDeleted':
            handleChannelDeleted(data);
            break;
        case 'channelRenamed':
            handleChannelRenamed(data);
            break;
        case 'voiceUpdate':
            handleVoiceUpdate(data);
            break;
        case 'privateMessage':
            handlePrivateMessage(data);
            break;
        case 'webrtc-offer':
        case 'webrtc-answer':
        case 'webrtc-ice':
            handleWebRTC(data);
            break;
        case 'error':
            showNotification(data.message, 'error');
            break;
    }
}

function handleAuthSuccess(data) {
    servers.clear();
    data.servers.forEach(server => {
        servers.set(server.id, server);
    });
    updateServersList();
    selectServer(currentServerId);
    showNotification(`Добро пожаловать, ${currentUser.username}!`, 'success');
}

function handleMessage(data) {
    const key = `${data.serverId}-${data.channelId}`;
    if (!channelMessages.has(key)) {
        channelMessages.set(key, []);
    }
    channelMessages.get(key).push(data);
    
    if (data.serverId === currentServerId && data.channelId === currentChannelId) {
        displayMessage(data);
    }
}

function handleServerCreated(data) {
    servers.set(data.server.id, data.server);
    updateServersList();
    showNotification('Сервер создан!', 'success');
}

function handleChannelCreated(data) {
    const server = servers.get(data.serverId);
    if (server) {
        if (data.channel.type === 'text') {
            server.textChannels.push(data.channel);
        } else {
            server.voiceChannels.push(data.channel);
        }
        if (data.serverId === currentServerId) {
            updateChannelsList();
        }
    }
}

function handleChannelDeleted(data) {
    const server = servers.get(data.serverId);
    if (server) {
        if (data.channelType === 'text') {
            server.textChannels = server.textChannels.filter(c => c.id !== data.channelId);
        } else {
            server.voiceChannels = server.voiceChannels.filter(c => c.id !== data.channelId);
        }
        if (data.serverId === currentServerId) {
            updateChannelsList();
        }
    }
}

function handleChannelRenamed(data) {
    const server = servers.get(data.serverId);
    if (server) {
        const channels = data.channelType === 'text' ? server.textChannels : server.voiceChannels;
        const channel = channels.find(c => c.id === data.channelId);
        if (channel) {
            channel.name = data.newName;
            if (data.serverId === currentServerId) {
                updateChannelsList();
            }
        }
    }
}

function handleVoiceUpdate(data) {
    const server = servers.get(data.serverId);
    if (server) {
        const channel = server.voiceChannels.find(c => c.id === data.channelId);
        if (channel) {
            channel.members = data.members;
            if (data.serverId === currentServerId) {
                updateVoiceChannelMembers();
            }
        }
    }
}

function handlePrivateMessage(data) {
    const conversationKey = data.from === currentUser.username ? data.to : data.from;
    
    if (!dmConversations.has(conversationKey)) {
        dmConversations.set(conversationKey, []);
    }
    
    dmConversations.get(conversationKey).push(data);
    
    if (currentDMUser === conversationKey) {
        displayPrivateMessage(data.from, data.text, data.time);
    } else if (data.from !== currentUser.username) {
        showDMNotification(data.from);
    }
}


// ===== UI - СЕРВЕРЫ И КАНАЛЫ =====
function updateServersList() {
    const serverList = document.querySelector('.server-list');
    serverList.innerHTML = '';
    
    servers.forEach((server, serverId) => {
        const serverEl = document.createElement('div');
        serverEl.className = `server ${serverId === currentServerId ? 'active' : ''}`;
        serverEl.onclick = () => selectServer(serverId);
        serverEl.oncontextmenu = (e) => {
            e.preventDefault();
            showServerContextMenu(e, serverId);
        };
        serverEl.innerHTML = `<span>${server.name.charAt(0).toUpperCase()}</span>`;
        serverList.appendChild(serverEl);
    });
    
    const addBtn = document.createElement('div');
    addBtn.className = 'add-server';
    addBtn.onclick = createServer;
    addBtn.innerHTML = '+';
    serverList.appendChild(addBtn);
}

function selectServer(serverId) {
    currentServerId = serverId;
    const server = servers.get(serverId);
    if (server && server.textChannels.length > 0) {
        currentChannelId = server.textChannels[0].id;
    }
    updateServersList();
    updateChannelsList();
    loadMessages();
}

function updateChannelsList() {
    const server = servers.get(currentServerId);
    if (!server) return;
    
    const channelsContainer = document.querySelector('.channels');
    channelsContainer.innerHTML = `
        <div class="server-header" onclick="showServerSettings()">
            <span class="server-name">${server.name}</span>
            <span class="server-settings-icon">⚙️</span>
        </div>
    `;
    
    // Текстовые каналы
    const textSection = document.createElement('div');
    textSection.innerHTML = `
        <div class="channel-category">
            <span>ТЕКСТОВЫЕ КАНАЛЫ</span>
            <span class="add-channel-btn" onclick="createChannel('text')">+</span>
        </div>
    `;
    channelsContainer.appendChild(textSection);
    
    server.textChannels.forEach(channel => {
        const channelEl = document.createElement('div');
        channelEl.className = `channel ${channel.id === currentChannelId ? 'active' : ''}`;
        channelEl.onclick = () => selectChannel(channel.id);
        channelEl.oncontextmenu = (e) => {
            e.preventDefault();
            showChannelContextMenu(e, channel.id, 'text');
        };
        channelEl.innerHTML = `<span>#</span> ${channel.name}`;
        channelsContainer.appendChild(channelEl);
    });
    
    // Голосовые каналы
    const voiceSection = document.createElement('div');
    voiceSection.innerHTML = `
        <div class="channel-category">
            <span>ГОЛОСОВЫЕ КАНАЛЫ</span>
            <span class="add-channel-btn" onclick="createChannel('voice')">+</span>
        </div>
    `;
    channelsContainer.appendChild(voiceSection);
    
    server.voiceChannels.forEach(channel => {
        const channelEl = document.createElement('div');
        channelEl.className = `channel voice ${currentVoiceChannel === channel.id ? 'connected' : ''}`;
        channelEl.onclick = () => toggleVoiceChannel(channel.id);
        channelEl.oncontextmenu = (e) => {
            e.preventDefault();
            showChannelContextMenu(e, channel.id, 'voice');
        };
        channelEl.innerHTML = `
            <div class="voice-channel-header">
                <span>🔊</span> ${channel.name}
            </div>
            <div class="voice-members" id="voice-members-${channel.id}"></div>
        `;
        channelsContainer.appendChild(channelEl);
    });
    
    updateVoiceChannelMembers();
}

function selectChannel(channelId) {
    currentChannelId = channelId;
    updateChannelsList();
    loadMessages();
    document.querySelector('.channel-name').textContent = `# ${channelId}`;
}

function updateVoiceChannelMembers() {
    const server = servers.get(currentServerId);
    if (!server) return;
    
    server.voiceChannels.forEach(channel => {
        const membersDiv = document.getElementById(`voice-members-${channel.id}`);
        if (membersDiv && channel.members) {
            membersDiv.innerHTML = '';
            channel.members.forEach(member => {
                const memberEl = document.createElement('div');
                memberEl.className = 'voice-member';
                memberEl.innerHTML = `
                    <span class="status speaking"></span>
                    <span>${member}</span>
                `;
                membersDiv.appendChild(memberEl);
            });
        }
    });
}

function createServer() {
    const name = prompt('Введите название сервера:');
    if (name && name.trim() && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'createServer',
            serverName: name.trim()
        }));
    }
}

function createChannel(type) {
    const name = prompt(`Введите название ${type === 'text' ? 'текстового' : 'голосового'} канала:`);
    if (name && name.trim() && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'createChannel',
            serverId: currentServerId,
            channelName: name.trim(),
            channelType: type
        }));
    }
}

function showServerContextMenu(e, serverId) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.innerHTML = `
        <div class="context-menu-item" onclick="showServerSettings()">⚙️ Настройки сервера</div>
        <div class="context-menu-item danger" onclick="deleteServer('${serverId}')">🗑️ Удалить сервер</div>
    `;
    document.body.appendChild(menu);
    
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 0);
}

function showChannelContextMenu(e, channelId, type) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.innerHTML = `
        <div class="context-menu-item" onclick="renameChannel('${channelId}', '${type}')">✏️ Переименовать</div>
        <div class="context-menu-item danger" onclick="deleteChannel('${channelId}', '${type}')">🗑️ Удалить канал</div>
    `;
    document.body.appendChild(menu);
    
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 0);
}

function renameChannel(channelId, type) {
    const newName = prompt('Введите новое название:');
    if (newName && newName.trim() && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'renameChannel',
            serverId: currentServerId,
            channelId: channelId,
            channelType: type,
            newName: newName.trim()
        }));
    }
}

function deleteChannel(channelId, type) {
    if (confirm('Удалить этот канал?') && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'deleteChannel',
            serverId: currentServerId,
            channelId: channelId,
            channelType: type
        }));
    }
}


// ===== СООБЩЕНИЯ =====
function loadMessages() {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    
    const key = `${currentServerId}-${currentChannelId}`;
    const messages = channelMessages.get(key) || [];
    messages.forEach(msg => displayMessage(msg));
}

function displayMessage(message) {
    const messagesDiv = document.getElementById('messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    
    const avatar = message.author.charAt(0).toUpperCase();
    const avatarColor = getRandomColor(message.author);
    
    messageEl.innerHTML = `
        <div class="message-avatar" style="background: ${avatarColor}">
            <span>${avatar}</span>
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${message.author}</span>
                <span class="message-time">${message.time}</span>
            </div>
            <div class="message-text">${escapeHtml(message.text)}</div>
        </div>
    `;
    
    messagesDiv.appendChild(messageEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('messageText');
    const text = input.value.trim();
    
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) {
        if (!text) return;
        showNotification('Нет соединения с сервером', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'message',
        text: text,
        channelId: currentChannelId,
        serverId: currentServerId
    }));
    
    input.value = '';
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// ===== УЧАСТНИКИ =====
function updateMembersList() {
    const membersList = document.getElementById('membersList');
    membersList.innerHTML = '';
    
    onlineUsers.forEach(user => {
        const memberEl = document.createElement('div');
        memberEl.className = 'member';
        memberEl.style.cursor = 'pointer';
        memberEl.onclick = () => openDMWithUser(user.username);
        
        const statusClass = user.voiceChannel ? 'voice' : 'online';
        
        memberEl.innerHTML = `
            <span class="status ${statusClass}"></span>
            <span class="member-name">${user.username}</span>
            ${user.voiceChannel ? '<span class="voice-indicator">🎤</span>' : ''}
        `;
        membersList.appendChild(memberEl);
    });
    
    const memberCount = document.getElementById('memberCount');
    if (memberCount) {
        memberCount.textContent = onlineUsers.length;
    }
}

// ===== WEBRTC - ГОЛОСОВОЙ ЧАТ =====
async function toggleVoiceChannel(channelId) {
    if (currentVoiceChannel === channelId) {
        leaveVoiceChannel();
    } else {
        await joinVoiceChannel(channelId);
    }
}

async function joinVoiceChannel(channelId) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
        
        isInVoiceChannel = true;
        currentVoiceChannel = channelId;
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'voiceJoin',
                serverId: currentServerId,
                channelId: channelId
            }));
        }
        
        updateChannelsList();
        document.getElementById('voiceControls').classList.add('active');
        
        // Подключаемся к другим участникам
        const server = servers.get(currentServerId);
        const channel = server.voiceChannels.find(c => c.id === channelId);
        if (channel && channel.members) {
            channel.members.forEach(member => {
                if (member !== currentUser.username) {
                    createPeerConnection(member, true);
                }
            });
        }
        
        showNotification('Подключено к голосовому каналу', 'success');
        
    } catch (error) {
        console.error('Ошибка доступа к микрофону:', error);
        showNotification('Не удалось получить доступ к микрофону', 'error');
    }
}

function leaveVoiceChannel() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'voiceLeave'
        }));
    }
    
    isInVoiceChannel = false;
    currentVoiceChannel = null;
    
    updateChannelsList();
    document.getElementById('voiceControls').classList.remove('active');
    showNotification('Отключено от голосового канала', 'info');
}

function createPeerConnection(username, isInitiator) {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'webrtc-ice',
                target: username,
                candidate: event.candidate
            }));
        }
    };
    
    peerConnections.set(username, pc);
    
    if (isInitiator) {
        pc.createOffer().then(offer => {
            pc.setLocalDescription(offer);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'webrtc-offer',
                    target: username,
                    offer: offer
                }));
            }
        });
    }
    
    return pc;
}

function handleWebRTC(data) {
    if (data.type === 'webrtc-offer') {
        const pc = createPeerConnection(data.from, false);
        pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        pc.createAnswer().then(answer => {
            pc.setLocalDescription(answer);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'webrtc-answer',
                    target: data.from,
                    answer: answer
                }));
            }
        });
    } else if (data.type === 'webrtc-answer') {
        const pc = peerConnections.get(data.from);
        if (pc) {
            pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    } else if (data.type === 'webrtc-ice') {
        const pc = peerConnections.get(data.from);
        if (pc) {
            pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }
}

function toggleMute() {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    
    const btn = document.getElementById('muteBtn');
    btn.innerHTML = audioTrack.enabled ? '<span>🎤</span> Выключить микрофон' : '<span>🔇</span> Включить микрофон';
    btn.classList.toggle('muted', !audioTrack.enabled);
}

async function shareScreen() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 20 }
            },
            audio: false
        });
        
        // Заменяем видео трек в существующих соединениях
        peerConnections.forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(screenStream.getVideoTracks()[0]);
            } else {
                pc.addTrack(screenStream.getVideoTracks()[0], screenStream);
            }
        });
        
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };
        
        document.getElementById('screenShareBtn').innerHTML = '<span>🖥️</span> Остановить демонстрацию';
        showNotification('Демонстрация экрана началась', 'success');
        
    } catch (error) {
        console.error('Ошибка демонстрации экрана:', error);
        showNotification('Не удалось начать демонстрацию экрана', 'error');
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        
        document.getElementById('screenShareBtn').innerHTML = '<span>🖥️</span> Демонстрация экрана';
        showNotification('Демонстрация экрана остановлена', 'info');
    }
}


// ===== ПРИВАТНЫЕ СООБЩЕНИЯ =====
function openDMWithUser(username) {
    if (username === currentUser.username) {
        showNotification('Нельзя писать самому себе', 'error');
        return;
    }
    
    currentDMUser = username;
    
    let dmModal = document.getElementById('dm-modal');
    if (!dmModal) {
        createDMModal();
        dmModal = document.getElementById('dm-modal');
    }
    
    document.getElementById('dmUserName').textContent = username;
    
    const dmMessages = document.getElementById('dmMessages');
    dmMessages.innerHTML = '';
    
    if (dmConversations.has(username)) {
        dmConversations.get(username).forEach(msg => {
            displayPrivateMessage(msg.from, msg.text, msg.time);
        });
    }
    
    dmModal.classList.add('active');
    setTimeout(() => document.getElementById('dmInput').focus(), 100);
}

function createDMModal() {
    const modal = document.createElement('div');
    modal.id = 'dm-modal';
    modal.className = 'modal dm-modal';
    modal.innerHTML = `
        <div class="modal-content dm-content">
            <div class="dm-header">
                <span id="dmUserName">Пользователь</span>
                <span class="close" onclick="closeDM()">&times;</span>
            </div>
            <div class="dm-messages" id="dmMessages"></div>
            <div class="dm-input-area">
                <input type="text" id="dmInput" placeholder="Напишите сообщение..." onkeypress="handleDMKeyPress(event)">
                <button onclick="sendDM()">Отправить</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function displayPrivateMessage(from, text, time) {
    const dmMessages = document.getElementById('dmMessages');
    const messageEl = document.createElement('div');
    messageEl.className = `dm-message ${from === currentUser.username ? 'sent' : 'received'}`;
    
    messageEl.innerHTML = `
        <div class="dm-message-content">
            <div class="dm-message-author">${from}</div>
            <div class="dm-message-text">${escapeHtml(text)}</div>
            <div class="dm-message-time">${time}</div>
        </div>
    `;
    
    dmMessages.appendChild(messageEl);
    dmMessages.scrollTop = dmMessages.scrollHeight;
}

function sendDM() {
    const input = document.getElementById('dmInput');
    const text = input.value.trim();
    
    if (!text || !currentDMUser || !ws || ws.readyState !== WebSocket.OPEN) {
        if (!text) return;
        showNotification('Нет соединения с сервером', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'privateMessage',
        recipientUsername: currentDMUser,
        text: text
    }));
    
    input.value = '';
}

function handleDMKeyPress(event) {
    if (event.key === 'Enter') {
        sendDM();
    }
}

function closeDM() {
    const dmModal = document.getElementById('dm-modal');
    if (dmModal) {
        dmModal.classList.remove('active');
    }
    currentDMUser = null;
}

function showDMNotification(username) {
    showNotification(`${username} отправил вам сообщение`, 'info', () => {
        openDMWithUser(username);
    });
}

// ===== УТИЛИТЫ =====
function getRandomColor(str) {
    const colors = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#57f287'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = 'info', onClick = null) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    if (onClick) {
        notification.style.cursor = 'pointer';
        notification.onclick = () => {
            onClick();
            notification.remove();
        };
    }
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function loadUserData() {
    const savedAvatar = localStorage.getItem('userAvatar');
    if (savedAvatar) {
        userAvatar = savedAvatar;
    }
    
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.className = `theme-${savedTheme}`;
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

// Настройки сервера
function showServerSettings() {
    const modal = document.getElementById('server-settings-modal');
    if (!modal) {
        createServerSettingsModal();
    }
    const server = servers.get(currentServerId);
    if (server) {
        document.getElementById('serverNameInput').value = server.name;
    }
    document.getElementById('server-settings-modal').classList.add('active');
}

function createServerSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'server-settings-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="closeModal('server-settings-modal')">&times;</span>
            <h2>⚙️ Настройки сервера</h2>
            <div class="settings-section">
                <h3>Название сервера</h3>
                <input type="text" id="serverNameInput" class="settings-input" placeholder="Название сервера">
                <button class="settings-btn" onclick="saveServerSettings()">Сохранить</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function saveServerSettings() {
    const newName = document.getElementById('serverNameInput').value.trim();
    if (newName) {
        const server = servers.get(currentServerId);
        if (server) {
            server.name = newName;
            updateServersList();
            updateChannelsList();
            closeModal('server-settings-modal');
            showNotification('Настройки сохранены', 'success');
        }
    }
}

// Закрытие модальных окон при клике вне их
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
}

// Заглушки для дополнительных функций
function showWeather() { showNotification('Функция в разработке', 'info'); }
function showStocks() { showNotification('Функция в разработке', 'info'); }
function showGroups() { showNotification('Функция в разработке', 'info'); }
function showNitro() { showNotification('Функция в разработке', 'info'); }
function showSettings() { showNotification('Функция в разработке', 'info'); }
