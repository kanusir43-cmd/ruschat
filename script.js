let currentUser = null;
let ws = null;
let onlineUsers = [];
let currentDMUser = null;
let dmConversations = new Map();
let servers = new Map();
let channels = new Map();
let currentServerId = 'default-server';
let currentChannelId = 'general';
let channelMessages = new Map();
let userAvatar = null;
let isInVoiceChannel = false;
let audioStream = null;
let audioContext = null;
let analyser = null;
let microphone = null;

// Проверка российского номера телефона
function isRussianPhone(phone) {
    return phone.startsWith('+7') && phone.length >= 12;
}

function login() {
    const username = document.getElementById('username').value.trim();
    const phone = document.getElementById('phone').value.trim();
    
    if (!username) {
        alert('Введите имя пользователя');
        return;
    }
    
    if (!isRussianPhone(phone)) {
        alert('Доступ разрешен только для российских номеров (+7)');
        return;
    }
    
    currentUser = {
        username: username,
        phone: phone,
        id: Date.now()
    };
    
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');
    
    initializeServers();
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
    onlineUsers = [];
    dmConversations.clear();
    servers.clear();
    channels.clear();
    channelMessages.clear();
    
    document.getElementById('chat-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('username').value = '';
    document.getElementById('phone').value = '';
}

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
            
            if (data.type === 'authSuccess') {
                console.log('✅ Аутентификация успешна');
            }
            
            if (data.type === 'userList') {
                onlineUsers = data.users;
                updateMembersList();
            }
            
            if (data.type === 'message') {
                if (!channelMessages.has(data.channelId)) {
                    channelMessages.set(data.channelId, []);
                }
                channelMessages.get(data.channelId).push(data);
                
                if (data.channelId === currentChannelId) {
                    displayMessage(data);
                }
            }
            
            if (data.type === 'serverCreated') {
                servers.set(data.server.id, data.server);
                channels.set(`${data.server.id}-general`, {
                    id: 'general',
                    name: 'общий',
                    messages: [],
                    serverId: data.server.id
                });
                updateServersList();
            }
            
            if (data.type === 'privateMessage') {
                const conversationKey = data.from === currentUser.username ? data.to : data.from;
                
                if (!dmConversations.has(conversationKey)) {
                    dmConversations.set(conversationKey, []);
                }
                
                dmConversations.get(conversationKey).push({
                    from: data.from,
                    text: data.text,
                    time: data.time
                });
                
                if (currentDMUser === conversationKey) {
                    displayPrivateMessage(data.from, data.text, data.time);
                } else {
                    showDMNotification(data.from);
                }
            }
            
            if (data.type === 'error') {
                alert(data.message);
            }
            
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket ошибка:', error);
    };
    
    ws.onclose = () => {
        console.log('❌ WebSocket отключен');
    };
}

function updateMembersList() {
    const membersList = document.getElementById('membersList');
    membersList.innerHTML = '';
    
    onlineUsers.forEach(user => {
        const memberEl = document.createElement('div');
        memberEl.className = 'member';
        memberEl.style.cursor = 'pointer';
        memberEl.onclick = () => openDMWithUser(user.username);
        memberEl.innerHTML = `
            <span class="status online"></span>
            <span class="member-name">${user.username}</span>
        `;
        membersList.appendChild(memberEl);
    });
    
    const memberCount = document.getElementById('memberCount');
    if (memberCount) {
        memberCount.textContent = onlineUsers.length;
    }
}

function loadMessages() {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    
    const messages = channelMessages.get(currentChannelId) || [];
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
        alert('Нет соединения с сервером');
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'message',
        text: text,
        channelId: currentChannelId
    }));
    
    input.value = '';
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

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

// ===== СЕРВЕРЫ И КАНАЛЫ =====

function initializeServers() {
    servers.set('default-server', {
        id: 'default-server',
        name: 'РусЧат',
        channels: ['general', 'news', 'stocks']
    });
    
    channels.set('default-server-general', {
        id: 'general',
        name: 'общий',
        messages: [],
        serverId: 'default-server'
    });
    
    channels.set('default-server-news', {
        id: 'news',
        name: 'новости',
        message: [],
        serverId: 'default-server'
    });
    
    channels.set('default-server-stocks', {
        id: 'stocks',
        name: 'акции',
        messages: [],
        serverId: 'default-server'
    });
    
    updateServersList();
    updateChannelsList();
}

function updateServersList() {
    const serverList = document.querySelector('.server-list');
    serverList.innerHTML = '';
    
    servers.forEach((server, serverId) => {
        const serverEl = document.createElement('div');
        serverEl.className = `server ${serverId === currentServerId ? 'active' : ''}`;
        serverEl.onclick = () => selectServer(serverId);
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
    currentChannelId = 'general';
    updateServersList();
    updateChannelsList();
    loadMessages();
}

function updateChannelsList() {
    const server = servers.get(currentServerId);
    if (!server) return;
    
    const channelsContainer = document.querySelector('.channels');
    let channelList = channelsContainer.querySelector('.channel-list');
    
    if (!channelList) {
        channelList = document.createElement('div');
        channelList.className = 'channel-list';
        channelsContainer.appendChild(channelList);
    }
    
    channelList.innerHTML = `
        <div class="server-name" onclick="showServerSettings()">
            <span id="currentServerName">${server.name}</span>
            <span class="server-settings-icon">⚙️</span>
        </div>
        <div class="channel-category">ТЕКСТОВЫЕ КАНАЛЫ</div>
    `;
    
    server.channels.forEach(channelId => {
        const channel = channels.get(`${currentServerId}-${channelId}`);
        if (channel) {
            const channelEl = document.createElement('div');
            channelEl.className = `channel ${channelId === currentChannelId ? 'active' : ''}`;
            channelEl.onclick = () => selectChannel(channelId);
            channelEl.innerHTML = `<span>#</span> ${channel.name}`;
            channelList.appendChild(channelEl);
        }
    });
    
    const voiceSection = document.createElement('div');
    voiceSection.innerHTML = `
        <div class="channel-category">ГОЛОСОВЫЕ КАНАЛЫ</div>
        <div class="channel voice" onclick="toggleVoiceChannel()">
            <span>🔊</span> Общая комната
        </div>
    `;
    channelList.appendChild(voiceSection);
}

function selectChannel(channelId) {
    currentChannelId = channelId;
    updateChannelsList();
    loadMessages();
    document.querySelector('.channel-name').textContent = `# ${currentChannelId}`;
}

function createServer() {
    const name = prompt('Введите название сервера:');
    if (name && name.trim()) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'createServer',
                serverName: name.trim()
            }));
        }
    }
}

// ===== ПРИВАТНЫЕ СООБЩЕНИЯ (ДМ) =====

function openDMWithUser(username) {
    if (username === currentUser.username) {
        alert('Нельзя писать самому себе 😄');
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
    
    setTimeout(() => {
        document.getElementById('dmInput').focus();
    }, 100);
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
        alert('Нет соединения с сервером');
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
    const notification = document.createElement('div');
    notification.className = 'dm-notification';
    notification.innerHTML = `
        <strong>${username}</strong> отправил вам сообщение
        <button onclick="openDMWithUser('${username}')">Открыть</button>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// ===== ГОЛОСОВОЙ ЧАТ И ДЕМОНСТРАЦИЯ ЭКРАНА =====

async function toggleVoiceChannel() {
    if (!isInVoiceChannel) {
        await joinVoiceChannel();
    } else {
        leaveVoiceChannel();
    }
}

async function joinVoiceChannel() {
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        isInVoiceChannel = true;
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(audioStream);
        
        analyser.fftSize = 256;
        microphone.connect(analyser);
        
        updateVoiceChannelUI();
        document.getElementById('voiceSettings').classList.add('active');
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'voiceJoin'
            }));
        }
        
        visualizeAudio();
        
    } catch (error) {
        console.error('Ошибка доступа к микрофону:', error);
        alert('Не удалось получить доступ к микрофону');
    }
}

function leaveVoiceChannel() {
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    isInVoiceChannel = false;
    analyser = null;
    microphone = null;
    
    updateVoiceChannelUI();
    document.getElementById('voiceSettings').classList.remove('active');
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'voiceLeave'
        }));
    }
}

function updateVoiceChannelUI() {
    const voiceChannel = document.querySelector('.channel.voice');
    if (isInVoiceChannel) {
        voiceChannel.classList.add('connected');
        voiceChannel.innerHTML = `
            <span>🔊</span> Общая комната
            <span class="voice-indicator">●</span>
        `;
    } else {
        voiceChannel.classList.remove('connected');
        voiceChannel.innerHTML = `<span>🔊</span> Общая комната`;
    }
}

function visualizeAudio() {
    if (!analyser || !isInVoiceChannel) return;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    requestAnimationFrame(visualizeAudio);
}

async function shareScreen() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 20 }
            },
            audio: false
        });
        
        const screenModal = document.getElementById('screen-share-modal');
        if (!screenModal) {
            createScreenShareModal();
        }
        
        const video = document.getElementById('screenShareVideo');
        video.srcObject = screenStream;
        
        document.getElementById('screen-share-modal').classList.add('active');
        
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };
        
    } catch (error) {
        console.error('Ошибка при демонстрации экрана:', error);
    }
}

function createScreenShareModal() {
    const modal = document.createElement('div');
    modal.id = 'screen-share-modal';
    modal.className = 'modal screen-share-modal';
    modal.innerHTML = `
        <div class="modal-content screen-share-content">
            <div class="screen-share-header">
                <span>Демонстрация экрана (720p, 20fps)</span>
                <button onclick="stopScreenShare()" class="close-btn">✕</button>
            </div>
            <video id="screenShareVideo" autoplay playsinline style="width: 100%; height: 100%; object-fit: contain;"></video>
        </div>
    `;
    document.body.appendChild(modal);
}

function stopScreenShare() {
    const video = document.getElementById('screenShareVideo');
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
    
    const modal = document.getElementById('screen-share-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function toggleMute() {
    if (!audioStream) return;
    
    const audioTrack = audioStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    
    const btn = event.target;
    btn.textContent = audioTrack.enabled ? '🎤 Откл./Вкл. микрофон' : '🔇 Микрофон выключен';
}

// ===== УТИЛИТЫ =====

function loadUserData() {
    const savedAvatar = localStorage.getItem('userAvatar');
    if (savedAvatar) {
        userAvatar = savedAvatar;
    }
    
    if (currentUser) {
        document.getElementById('profileName').textContent = currentUser.username;
    }
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
}

// Заглушки для остальных функций
function showWeather() { alert('Функция в разработке'); }
function showStocks() { alert('Функция в разработке'); }
function showGroups() { alert('Функция в разработке'); }
function showNitro() { alert('Функция в разработке'); }
function showSettings() { alert('Функция в разработке'); }
function showServerSettings() { alert('Функция в разработке'); }
