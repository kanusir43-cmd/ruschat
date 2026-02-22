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
            <h2>🌤️ Прогноз погоды</h2>
            <div class="weather-search">
                <input type="text" id="cityInput" placeholder="Введите город..." value="Москва">
                <button onclick="loadWeather()">Поиск</button>
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
        'Ясно': '☀️',
        'Облачно': '☁️',
        'Дождь': '🌧️',
        'Снег': '❄️',
        'Переменная облачность': '⛅'
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
                <span>💧 Влажность</span>
                <span>${humidity}%</span>
            </div>
            <div class="weather-detail">
                <span>💨 Ветер</span>
                <span>${wind} м/с</span>
            </div>
            <div class="weather-detail">
                <span>🌡️ Ощущается как</span>
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
    const icons = ['☀️', '⛅', '☁️', '🌧️', '❄️'];
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
            <h2>📈 Российские акции</h2>
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
        
        const stockEl = document.createElement('div');
        stockEl.className = 'stock-item';
        stockEl.innerHTML = `
            <div>
                <div class="stock-name">${stock.name} (${stock.ticker})</div>
            </div>
            <div style="text-align: right;">
                <div class="stock-price">${stock.price.toFixed(2)} ₽</div>
                <div class="stock-change ${changeClass}">${changeSign}${stock.change}%</div>
            </div>
        `;
        stocksList.appendChild(stockEl);
    });
}

// ===== ГРУППЫ =====

let groups = [];
let currentGroupId = null;
let groupAvatars = {};

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
            <h2>👥 Группы</h2>
            <button class="settings-btn" onclick="createGroup()">+ Создать группу</button>
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
                ${!groupAvatars[group.id] ? `<span>${group.name.charAt(0).toUpperCase()}</span>` : ''}
            </div>
            <div class="group-info">
                <div class="group-name">${group.name}</div>
                <div class="group-members-count">${group.members.length} участников</div>
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
    
    const groupAvatar = document.getElementById('groupAvatar');
    if (groupAvatars[groupId]) {
        groupAvatar.style.backgroundImage = `url(${groupAvatars[groupId]})`;
        groupAvatar.style.backgroundSize = 'cover';
        groupAvatar.style.backgroundPosition = 'center';
        groupAvatar.querySelector('span').style.display = 'none';
    } else {
        groupAvatar.style.backgroundImage = '';
        groupAvatar.querySelector('span').style.display = 'flex';
        groupAvatar.querySelector('span').textContent = group.name.charAt(0).toUpperCase();
    }
    
    const membersList = document.getElementById('groupMembers');
    membersList.innerHTML = '';
    group.members.forEach(member => {
        const memberEl = document.createElement('div');
        memberEl.className = 'group-member-item';
        memberEl.innerHTML = `
            <span class="status online"></span>
            <span>${member}</span>
            ${member !== currentUser.username ? `<button onclick="removeFromGroup('${member}')" style="margin-left: auto; background: #ed4245; border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer;">✕</button>` : ''}
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
            <h2>⚙️ Настройки группы</h2>
            <div class="settings-section">
                <h3>Аватар группы</h3>
                <div class="profile-preview">
                    <div class="profile-avatar" id="groupAvatar">
                        <span id="groupAvatarText">Г</span>
                    </div>
                    <div>
                        <div class="profile-name" id="groupNameDisplay">Моя группа</div>
                    </div>
                </div>
                <button class="settings-btn" onclick="changeGroupAvatar()">Изменить аватар</button>
                <input type="file" id="groupAvatarInput" accept="image/*" style="display: none;" onchange="handleGroupAvatarUpload(event)">
            </div>
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
                    <button class="settings-btn" onclick="addMemberToGroup()">Добавить</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function changeGroupAvatar() {
    document.getElementById('groupAvatarInput').click();
}

function handleGroupAvatarUpload(event) {
    const file = event.target.files[0];
    if (file && currentGroupId) {
        const reader = new FileReader();
        reader.onload = function(e) {
            groupAvatars[currentGroupId] = e.target.result;
            localStorage.setItem('groupAvatars', JSON.stringify(groupAvatars));
            
            const groupAvatar = document.getElementById('groupAvatar');
            groupAvatar.style.backgroundImage = `url(${e.target.result})`;
            groupAvatar.style.backgroundSize = 'cover';
            groupAvatar.style.backgroundPosition = 'center';
            groupAvatar.querySelector('span').style.display = 'none';
        };
        reader.readAsDataURL(file);
    }
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
    }
}

function removeFromGroup(memberName) {
    if (!currentGroupId) return;
    
    const group = groups.find(g => g.id === currentGroupId);
    if (group) {
        group.members = group.members.filter(m => m !== memberName);
        localStorage.setItem('groups', JSON.stringify(groups));
        openGroupSettings(currentGroupId);
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
                <h1>⭐ РусНитро</h1>
                <p class="nitro-subtitle">Бесплатно для всех россиян!</p>
            </div>
            <div class="nitro-features">
                <div class="nitro-feature">
                    <span class="nitro-icon">🎨</span>
                    <div>
                        <h3>Кастомные аватары</h3>
                        <p>Загружайте свои изображения</p>
                    </div>
                </div>
                <div class="nitro-feature">
                    <span class="nitro-icon">😊</span>
                    <div>
                        <h3>Эмодзи везде</h3>
                        <p>Используйте эмодзи в любом месте</p>
                    </div>
                </div>
                <div class="nitro-feature">
                    <span class="nitro-icon">📁</span>
                    <div>
                        <h3>Большие файлы</h3>
                        <p>До 100 МБ вместо 8 МБ</p>
                    </div>
                </div>
                <div class="nitro-feature">
                    <span class="nitro-icon">🎬</span>
                    <div>
                        <h3>HD видео</h3>
                        <p>Трансляция в 1080p 60fps</p>
                    </div>
                </div>
                <div class="nitro-feature">
                    <span class="nitro-icon">🎭</span>
                    <div>
                        <h3>Профили</h3>
                        <p>Кастомизация профиля</p>
                    </div>
                </div>
                <div class="nitro-feature">
                    <span class="nitro-icon">🚀</span>
                    <div>
                        <h3>Буст серверов</h3>
                        <p>2 бесплатных буста</p>
                    </div>
                </div>
            </div>
            <div class="nitro-activated">
                <div class="nitro-badge-large">⭐ РусНитро Активирован</div>
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
            <h2>⚙️ Настройки</h2>
            <div class="settings-section">
                <h3>Профиль</h3>
                <div class="profile-preview">
                    <div class="profile-avatar" id="profileAvatar">
                        <span id="profileAvatarText">П</span>
                    </div>
                    <div>
                        <div class="profile-name" id="profileName">Пользователь</div>
                        <div class="nitro-badge">⭐ РусНитро</div>
                    </div>
                </div>
                <button class="settings-btn" onclick="changeAvatar()">Изменить аватар</button>
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
        profileAvatar.querySelector('span').style.display = 'none';
    }
}

function changeTheme() {
    const theme = document.getElementById('themeSelect').value;
    document.body.className = `theme-${theme}`;
    localStorage.setItem('theme', theme);
}

function showServerSettings() {
    const modal = document.getElementById('server-settings-modal');
    if (!modal) {
        createServerSettingsModal();
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
                <input type="text" id="serverNameInput" class="settings-input" placeholder="Название сервера" value="РусЧат Сервер" style="padding: 8px; border: 1px solid #555; border-radius: 4px; background: var(--bg-tertiary); color: var(--text-primary); width: 100%; margin-bottom: 8px;">
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
        }
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}
