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
let serverAvatars = new Map(); // Аватарки серверов

// Защита от спама
let lastMessageTime = 0;
let messageDebounceTimer = null;
const MIN_MESSAGE_INTERVAL = 500; // минимум 500мс между сообщениями

// ===== АУТЕНТИФИКАЦИЯ =====
function isRussianPhone(phone) {
    return phone.startsWith('+7') && phone.length >= 12;
}

function login() {
    console.log('Login clicked');
    const username = document.getElementById('username').value.trim();
    const phone = document.getElementById('phone').value.trim();
    
    console.log('Username:', username, 'Phone:', phone);
    
    if (!username) {
        alert('Введите имя пользователя');
        return;
    }
    
    if (!isRussianPhone(phone)) {
        alert('Доступ только для российских номеров (+7)');
        return;
    }
    
    currentUser = {
        username: username,
        phone: phone,
        id: Date.now()
    };
    
    console.log('User created:', currentUser);
    
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
    loadServerAvatars();
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
        
        const avatar = serverAvatars.get(serverId);
        if (avatar) {
            serverEl.style.backgroundImage = `url(${avatar})`;
            serverEl.style.backgroundSize = 'cover';
            serverEl.style.backgroundPosition = 'center';
            serverEl.innerHTML = '';
        } else {
            serverEl.innerHTML = `<span>${server.name.charAt(0).toUpperCase()}</span>`;
        }
        
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
    let messages = channelMessages.get(key) || [];
    
    // Ограничиваем количество отображаемых сообщений (последние 100)
    if (messages.length > 100) {
        messages = messages.slice(-100);
    }
    
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
    
    if (!text) return;
    
    // Проверка интервала между сообщениями
    const now = Date.now();
    if (now - lastMessageTime < MIN_MESSAGE_INTERVAL) {
        showNotification('Не спешите! Подождите немного перед следующим сообщением.', 'warning');
        return;
    }
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showNotification('Нет соединения с сервером', 'error');
        return;
    }
    
    // Проверка длины сообщения
    if (text.length > 2000) {
        showNotification('Сообщение слишком длинное (максимум 2000 символов)', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'message',
        text: text,
        channelId: currentChannelId,
        serverId: currentServerId
    }));
    
    lastMessageTime = now;
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
    
    if (!text) return;
    
    // Проверка интервала между сообщениями
    const now = Date.now();
    if (now - lastMessageTime < MIN_MESSAGE_INTERVAL) {
        showNotification('Не спешите! Подождите немного.', 'warning');
        return;
    }
    
    if (!currentDMUser || !ws || ws.readyState !== WebSocket.OPEN) {
        showNotification('Нет соединения с сервером', 'error');
        return;
    }
    
    if (text.length > 2000) {
        showNotification('Сообщение слишком длинное', 'error');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'privateMessage',
        recipientUsername: currentDMUser,
        text: text
    }));
    
    lastMessageTime = now;
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
        
        // Показываем аватар сервера
        const serverAvatarEl = document.getElementById('serverAvatarDisplay');
        const avatar = serverAvatars.get(currentServerId);
        if (avatar) {
            serverAvatarEl.style.backgroundImage = `url(${avatar})`;
            serverAvatarEl.style.backgroundSize = 'cover';
            serverAvatarEl.style.backgroundPosition = 'center';
            serverAvatarEl.querySelector('span').style.display = 'none';
        } else {
            serverAvatarEl.style.backgroundImage = '';
            serverAvatarEl.querySelector('span').style.display = 'flex';
            serverAvatarEl.querySelector('span').textContent = server.name.charAt(0).toUpperCase();
        }
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
            <h2><i class="fas fa-cog"></i> Настройки сервера</h2>
            <div class="settings-section">
                <h3>Аватар сервера</h3>
                <div class="profile-preview">
                    <div class="profile-avatar" id="serverAvatarDisplay">
                        <span>Р</span>
                    </div>
                    <div>
                        <div class="profile-name" id="serverNameDisplay">Сервер</div>
                    </div>
                </div>
                <button class="settings-btn" onclick="changeServerAvatar()"><i class="fas fa-image"></i> Изменить аватар</button>
                <input type="file" id="serverAvatarInput" accept="image/*" style="display: none;" onchange="handleServerAvatarUpload(event)">
            </div>
            <div class="settings-section">
                <h3>Название сервера</h3>
                <input type="text" id="serverNameInput" class="settings-input" placeholder="Название сервера">
                <button class="settings-btn" onclick="saveServerSettings()"><i class="fas fa-save"></i> Сохранить</button>
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

// ===== ПОГОДА =====
function showWeather() {
    const modal = document.getElementById('weather-modal');
    if (!modal) {
        createWeatherModal();
    }
    document.getElementById('weather-modal').classList.add('active');
    loadWeather();
}

function createWeatherModal() {
    const modal = document.createElement('div');
    modal.id = 'weather-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="closeModal('weather-modal')">&times;</span>
            <h2><i class="fas fa-cloud-sun"></i> Прогноз погоды</h2>
            <div class="weather-search">
                <input type="text" id="cityInput" placeholder="Введите город..." value="Москва">
                <button onclick="loadWeather()"><i class="fas fa-search"></i></button>
            </div>
            <div id="weatherContent"></div>
        </div>
    `;
    document.body.appendChild(modal);
}

function loadWeather() {
    const city = document.getElementById('cityInput').value.trim() || 'Москва';
    const weatherContent = document.getElementById('weatherContent');
    
    const temp = Math.floor(Math.random() * 30) - 10;
    const conditions = ['Ясно', 'Облачно', 'Дождь', 'Снег', 'Переменная облачность'];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const humidity = Math.floor(Math.random() * 40) + 40;
    const wind = Math.floor(Math.random() * 15) + 3;
    
    const weatherIcons = {
        'Ясно': '<i class="fas fa-sun"></i>',
        'Облачно': '<i class="fas fa-cloud"></i>',
        'Дождь': '<i class="fas fa-cloud-rain"></i>',
        'Снег': '<i class="fas fa-snowflake"></i>',
        'Переменная облачность': '<i class="fas fa-cloud-sun"></i>'
    };
    
    weatherContent.innerHTML = `
        <div class="weather-current">
            <div class="weather-icon">${weatherIcons[condition]}</div>
            <div class="weather-temp">${temp}°C</div>
            <div class="weather-condition">${condition}</div>
            <div class="weather-city">${city}</div>
        </div>
        <div class="weather-details">
            <div class="weather-detail">
                <span><i class="fas fa-droplet"></i> Влажность</span>
                <span>${humidity}%</span>
            </div>
            <div class="weather-detail">
                <span><i class="fas fa-wind"></i> Ветер</span>
                <span>${wind} м/с</span>
            </div>
            <div class="weather-detail">
                <span><i class="fas fa-thermometer"></i> Ощущается как</span>
                <span>${temp - 2}°C</span>
            </div>
        </div>
        <div class="weather-forecast">
            <h3>Прогноз на неделю</h3>
            <div class="forecast-days">
                ${generateForecast()}
            </div>
        </div>
    `;
}

function generateForecast() {
    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const icons = ['<i class="fas fa-sun"></i>', '<i class="fas fa-cloud-sun"></i>', '<i class="fas fa-cloud"></i>', '<i class="fas fa-cloud-rain"></i>', '<i class="fas fa-snowflake"></i>'];
    let html = '';
    
    for (let i = 0; i < 7; i++) {
        const temp = Math.floor(Math.random() * 25) - 5;
        const icon = icons[Math.floor(Math.random() * icons.length)];
        html += `
            <div class="forecast-day">
                <div>${days[i]}</div>
                <div class="forecast-icon">${icon}</div>
                <div class="forecast-temp">${temp}°</div>
            </div>
        `;
    }
    return html;
}

// ===== АКЦИИ =====
const russianStocks = [
    { name: 'Газпром', ticker: 'GAZP', price: 175.50, change: 2.3 },
    { name: 'Сбербанк', ticker: 'SBER', price: 285.20, change: -1.2 },
    { name: 'Лукойл', ticker: 'LKOH', price: 6420.00, change: 3.5 },
    { name: 'Яндекс', ticker: 'YNDX', price: 3250.00, change: 1.8 },
    { name: 'Роснефть', ticker: 'ROSN', price: 545.30, change: -0.5 },
    { name: 'Норникель', ticker: 'GMKN', price: 15800.00, change: 4.2 }
];

function showStocks() {
    const modal = document.getElementById('stocks-modal');
    if (!modal) {
        createStocksModal();
    }
    document.getElementById('stocks-modal').classList.add('active');
    updateStocks();
}

function createStocksModal() {
    const modal = document.createElement('div');
    modal.id = 'stocks-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="closeModal('stocks-modal')">&times;</span>
            <h2><i class="fas fa-chart-line"></i> Российские акции</h2>
            <div id="stocksList"></div>
        </div>
    `;
    document.body.appendChild(modal);
}

function updateStocks() {
    const stocksList = document.getElementById('stocksList');
    stocksList.innerHTML = '';
    
    russianStocks.forEach(stock => {
        const changeClass = stock.change >= 0 ? 'positive' : 'negative';
        const changeSign = stock.change >= 0 ? '+' : '';
        const changeIcon = stock.change >= 0 ? '<i class="fas fa-arrow-up"></i>' : '<i class="fas fa-arrow-down"></i>';
        
        const stockEl = document.createElement('div');
        stockEl.className = 'stock-item';
        stockEl.innerHTML = `
            <div>
                <div class="stock-name">${stock.name} (${stock.ticker})</div>
            </div>
            <div style="text-align: right;">
                <div class="stock-price">${stock.price.toFixed(2)} ₽</div>
                <div class="stock-change ${changeClass}">${changeIcon} ${changeSign}${stock.change}%</div>
            </div>
        `;
        stocksList.appendChild(stockEl);
    });
}

// ===== ГРУППЫ =====
let currentGroupId = null;

function showGroups() {
    const modal = document.getElementById('groups-modal');
    if (!modal) {
        createGroupsModal();
    }
    document.getElementById('groups-modal').classList.add('active');
    loadGroups();
}

function createGroupsModal() {
    const modal = document.createElement('div');
    modal.id = 'groups-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="closeModal('groups-modal')">&times;</span>
            <h2><i class="fas fa-users"></i> Группы</h2>
            <button class="settings-btn" onclick="createGroup()"><i class="fas fa-plus"></i> Создать группу</button>
            <div id="groupsList" class="groups-list"></div>
        </div>
    `;
    document.body.appendChild(modal);
}

function loadGroups() {
    const saved = localStorage.getItem('groups');
    if (saved) {
        groups = JSON.parse(saved);
    }
    
    const groupsList = document.getElementById('groupsList');
    groupsList.innerHTML = '';
    
    if (groups.length === 0) {
        groupsList.innerHTML = '<p class="empty-state">У вас пока нет групп. Создайте первую!</p>';
        return;
    }
    
    groups.forEach(group => {
        const groupEl = document.createElement('div');
        groupEl.className = 'group-item';
        groupEl.onclick = () => openGroupSettings(group.id);
        
        const avatarStyle = groupAvatars[group.id] 
            ? `background-image: url(${groupAvatars[group.id]}); background-size: cover; background-position: center;`
            : '';
        
        groupEl.innerHTML = `
            <div class="group-avatar" style="${avatarStyle}">
                ${!groupAvatars[group.id] ? `<i class="fas fa-users"></i>` : ''}
            </div>
            <div class="group-info">
                <div class="group-name">${group.name}</div>
                <div class="group-members-count"><i class="fas fa-user"></i> ${group.members.length}</div>
            </div>
        `;
        groupsList.appendChild(groupEl);
    });
}

function createGroup() {
    const name = prompt('Введите название группы:');
    if (name && name.trim()) {
        const group = {
            id: Date.now(),
            name: name.trim(),
            members: [currentUser.username],
            createdAt: new Date().toISOString()
        };
        
        groups.push(group);
        localStorage.setItem('groups', JSON.stringify(groups));
        loadGroups();
        showNotification('Группа создана!', 'success');
    }
}

function openGroupSettings(groupId) {
    currentGroupId = groupId;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    const modal = document.getElementById('group-settings-modal');
    if (!modal) {
        createGroupSettingsModal();
    }
    
    document.getElementById('groupNameInput').value = group.name;
    document.getElementById('groupNameDisplay').textContent = group.name;
    
    const membersList = document.getElementById('groupMembers');
    membersList.innerHTML = '';
    group.members.forEach(member => {
        const memberEl = document.createElement('div');
        memberEl.className = 'group-member-item';
        memberEl.innerHTML = `
            <span class="status online"></span>
            <span>${member}</span>
            ${member !== currentUser.username ? `<button onclick="removeFromGroup('${member}')" style="margin-left: auto; background: #ed4245; border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer;"><i class="fas fa-trash"></i></button>` : ''}
        `;
        membersList.appendChild(memberEl);
    });
    
    closeModal('groups-modal');
    document.getElementById('group-settings-modal').classList.add('active');
}

function createGroupSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'group-settings-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="closeModal('group-settings-modal')">&times;</span>
            <h2><i class="fas fa-cog"></i> Настройки группы</h2>
            <div class="settings-section">
                <h3>Название группы</h3>
                <input type="text" id="groupNameInput" class="settings-input" placeholder="Название группы">
                <button class="settings-btn" onclick="saveGroupSettings()">Сохранить</button>
            </div>
            <div class="settings-section">
                <h3>Участники</h3>
                <div id="groupMembers" class="group-members-list"></div>
                <div style="margin-top: 12px;">
                    <input type="text" id="addMemberInput" placeholder="Добавить участника..." style="padding: 8px; border: 1px solid #555; border-radius: 4px; background: var(--bg-tertiary); color: var(--text-primary); width: 100%; margin-bottom: 8px;">
                    <button class="settings-btn" onclick="addMemberToGroup()"><i class="fas fa-plus"></i> Добавить</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function saveGroupSettings() {
    if (!currentGroupId) return;
    
    const newName = document.getElementById('groupNameInput').value.trim();
    const group = groups.find(g => g.id === currentGroupId);
    
    if (newName && group) {
        group.name = newName;
        localStorage.setItem('groups', JSON.stringify(groups));
        closeModal('group-settings-modal');
        loadGroups();
        showNotification('Группа обновлена!', 'success');
    }
}

function addMemberToGroup() {
    const input = document.getElementById('addMemberInput');
    const memberName = input.value.trim();
    
    if (!memberName || !currentGroupId) return;
    
    const group = groups.find(g => g.id === currentGroupId);
    if (group && !group.members.includes(memberName)) {
        group.members.push(memberName);
        localStorage.setItem('groups', JSON.stringify(groups));
        input.value = '';
        openGroupSettings(currentGroupId);
        showNotification('Участник добавлен!', 'success');
    }
}

function removeFromGroup(memberName) {
    if (!currentGroupId) return;
    
    const group = groups.find(g => g.id === currentGroupId);
    if (group) {
        group.members = group.members.filter(m => m !== memberName);
        localStorage.setItem('groups', JSON.stringify(groups));
        openGroupSettings(currentGroupId);
        showNotification('Участник удален!', 'info');
    }
}

// ===== НИТРО =====
function showNitro() {
    const modal = document.getElementById('nitro-modal');
    if (!modal) {
        createNitroModal();
    }
    document.getElementById('nitro-modal').classList.add('active');
}

function createNitroModal() {
    const modal = document.createElement('div');
    modal.id = 'nitro-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content nitro-content">
            <span class="close" onclick="closeModal('nitro-modal')">&times;</span>
            <div class="nitro-header">
                <h1><i class="fas fa-star"></i> РусНитро</h1>
                <p class="nitro-subtitle">Бесплатно для всех россиян!</p>
            </div>
            <div class="nitro-features">
                <div class="nitro-feature">
                    <span class="nitro-icon"><i class="fas fa-palette"></i></span>
                    <div>
                        <h3>Кастомные аватары</h3>
                        <p>Загружайте свои изображения</p>
                    </div>
                </div>
                <div class="nitro-feature">
                    <span class="nitro-icon"><i class="fas fa-smile"></i></span>
                    <div>
                        <h3>Эмодзи везде</h3>
                        <p>Используйте эмодзи в любом месте</p>
                    </div>
                </div>
                <div class="nitro-feature">
                    <span class="nitro-icon"><i class="fas fa-folder"></i></span>
                    <div>
                        <h3>Большие файлы</h3>
                        <p>До 100 МБ вместо 8 МБ</p>
                    </div>
                </div>
                <div class="nitro-feature">
                    <span class="nitro-icon"><i class="fas fa-video"></i></span>
                    <div>
                        <h3>HD видео</h3>
                        <p>Трансляция в 1080p 60fps</p>
                    </div>
                </div>
                <div class="nitro-feature">
                    <span class="nitro-icon"><i class="fas fa-user-circle"></i></span>
                    <div>
                        <h3>Профили</h3>
                        <p>Кастомизация профиля</p>
                    </div>
                </div>
                <div class="nitro-feature">
                    <span class="nitro-icon"><i class="fas fa-rocket"></i></span>
                    <div>
                        <h3>Буст серверов</h3>
                        <p>2 бесплатных буста</p>
                    </div>
                </div>
            </div>
            <div class="nitro-activated">
                <div class="nitro-badge-large"><i class="fas fa-star"></i> РусНитро Активирован</div>
                <p>Вы получили все преимущества бесплатно!</p>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// ===== НАСТРОЙКИ =====
function showSettings() {
    const modal = document.getElementById('settings-modal');
    if (!modal) {
        createSettingsModal();
    }
    document.getElementById('settings-modal').classList.add('active');
}

function createSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="closeModal('settings-modal')">&times;</span>
            <h2><i class="fas fa-cog"></i> Настройки</h2>
            <div class="settings-section">
                <h3>Профиль</h3>
                <div class="profile-preview">
                    <div class="profile-avatar" id="profileAvatar">
                        <i class="fas fa-user"></i>
                    </div>
                    <div>
                        <div class="profile-name" id="profileName">Пользователь</div>
                        <div class="nitro-badge"><i class="fas fa-star"></i> РусНитро</div>
                    </div>
                </div>
                <button class="settings-btn" onclick="changeAvatar()"><i class="fas fa-image"></i> Изменить аватар</button>
                <input type="file" id="avatarInput" accept="image/*" style="display: none;" onchange="handleAvatarUpload(event)">
            </div>
            <div class="settings-section">
                <h3>Тема оформления</h3>
                <select id="themeSelect" onchange="changeTheme()" style="padding: 8px; border: 1px solid #555; border-radius: 4px; background: var(--bg-tertiary); color: var(--text-primary); width: 100%;">
                    <option value="dark">Темная</option>
                    <option value="light">Светлая</option>
                    <option value="blue">Синяя</option>
                </select>
            </div>
            <div class="settings-section">
                <h3>Уведомления</h3>
                <label class="checkbox-label">
                    <input type="checkbox" id="soundNotif" checked> Звуковые уведомления
                </label>
                <label class="checkbox-label">
                    <input type="checkbox" id="desktopNotif" checked> Уведомления на рабочем столе
                </label>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.getElementById('themeSelect').value = savedTheme;
}

function changeAvatar() {
    document.getElementById('avatarInput').click();
}

function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            userAvatar = e.target.result;
            localStorage.setItem('userAvatar', userAvatar);
            updateUserAvatar();
            showNotification('Аватар обновлен!', 'success');
        };
        reader.readAsDataURL(file);
    }
}

function updateUserAvatar() {
    const profileAvatar = document.getElementById('profileAvatar');
    if (profileAvatar && userAvatar) {
        profileAvatar.style.backgroundImage = `url(${userAvatar})`;
        profileAvatar.style.backgroundSize = 'cover';
        profileAvatar.style.backgroundPosition = 'center';
        profileAvatar.innerHTML = '';
    }
}

function changeTheme() {
    const theme = document.getElementById('themeSelect').value;
    document.body.className = `theme-${theme}`;
    localStorage.setItem('theme', theme);
    showNotification('Тема изменена!', 'success');
}

// Закрытие модальных окон при клике вне их
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
}


// ===== АВАТАР СЕРВЕРА =====
function changeServerAvatar() {
    document.getElementById('serverAvatarInput').click();
}

function handleServerAvatarUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const avatar = e.target.result;
            serverAvatars.set(currentServerId, avatar);
            localStorage.setItem(`serverAvatar-${currentServerId}`, avatar);
            
            // Обновляем отображение в модальном окне
            const serverAvatarEl = document.getElementById('serverAvatarDisplay');
            serverAvatarEl.style.backgroundImage = `url(${avatar})`;
            serverAvatarEl.style.backgroundSize = 'cover';
            serverAvatarEl.style.backgroundPosition = 'center';
            serverAvatarEl.querySelector('span').style.display = 'none';
            
            // Обновляем в списке серверов
            updateServersList();
            
            showNotification('Аватар сервера обновлен!', 'success');
        };
        reader.readAsDataURL(file);
    }
}

// Загрузка аватаров серверов из localStorage при загрузке
function loadServerAvatars() {
    servers.forEach((server, serverId) => {
        const savedAvatar = localStorage.getItem(`serverAvatar-${serverId}`);
        if (savedAvatar) {
            serverAvatars.set(serverId, savedAvatar);
        }
    });
}
