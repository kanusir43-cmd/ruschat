let currentUser = null;
let messages = [];
let ws = null;
let onlineUsers = [];
let currentDMUser = null;
let dmConversations = new Map();

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
    
    connectWebSocket();
    loadMessages();
    loadUserData();
}

function logout() {
    // Отключаемся от голосовой комнаты
    if (isInVoiceChannel) {
        leaveVoiceChannel();
    }
    
    if (ws) {
        ws.close();
    }
    currentUser = null;
    onlineUsers = [];
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
        
        // Отправляем данные аутентификации
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
            
            // Успешная аутентификация
            if (data.type === 'authSuccess') {
                addMessage({
                    author: 'Система',
                    text: data.message,
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                    isSystem: true
                });
            }
            
            // Получение списка онлайн пользователей
            if (data.type === 'userList') {
                onlineUsers = data.users;
                updateMembersList();
            }
            
            // Получение сообщения
            if (data.type === 'message') {
                addMessage({
                    author: data.author,
                    text: data.text,
                    time: data.time,
                    userId: data.userId,
                    isSystem: false
                });
            }
            
            // Приватное сообщение
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
                
                // Если это сообщение от текущего ДМ пользователя, показываем его
                if (currentDMUser === conversationKey) {
                    displayPrivateMessage(data.from, data.text, data.time);
                } else {
                    // Показываем уведомление
                    showDMNotification(data.from);
                }
            }
            
            // Системные сообщения
            if (data.type === 'system') {
                addMessage({
                    author: data.author,
                    text: data.text,
                    time: data.time,
                    isSystem: true
                });
            }
            
            // Уведомления о голосовой комнате
            if (data.type === 'voiceJoin') {
                addMessage({
                    author: 'Система',
                    text: `${data.username} присоединился к голосовой комнате 🎤`,
                    time: data.time,
                    isSystem: true
                });
            }
            
            if (data.type === 'voiceLeave') {
                addMessage({
                    author: 'Система',
                    text: `${data.username} покинул голосовую комнату 🔇`,
                    time: data.time,
                    isSystem: true
                });
            }
            
            // Ошибки
            if (data.type === 'error') {
                alert(data.message);
            }
            
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket ошибка:', error);
        alert('Ошибка подключения к серверу');
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
    // Загрузка сохраненных сообщений
    const saved = localStorage.getItem('messages');
    if (saved) {
        messages = JSON.parse(saved);
        messages.forEach(msg => displayMessage(msg));
    }
}

function sendMessage() {
    const input = document.getElementById('messageText');
    const text = input.value.trim();
    
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) {
        if (!text) return;
        alert('Нет соединения с сервером');
        return;
    }
    
    // Отправляем сообщение на сервер
    ws.send(JSON.stringify({
        type: 'message',
        text: text
    }));
    
    input.value = '';
}

function addMessage(message) {
    messages.push(message);
    localStorage.setItem('messages', JSON.stringify(messages));
    displayMessage(message);
}

function displayMessage(message) {
    const messagesDiv = document.getElementById('messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    
    const avatar = message.author.charAt(0).toUpperCase();
    const avatarColor = message.isSystem ? '#3ba55d' : getRandomColor(message.author);
    
    // Проверяем, есть ли аватар у пользователя
    const isCurrentUser = message.author === currentUser?.username;
    const hasAvatar = isCurrentUser && userAvatar;
    
    const avatarStyle = hasAvatar 
        ? `background-image: url(${userAvatar}); background-size: cover; background-position: center;`
        : `background: ${avatarColor}`;
    
    messageEl.innerHTML = `
        <div class="message-avatar" style="${avatarStyle}">
            ${!hasAvatar ? `<span>${avatar}</span>` : ''}
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${message.author}</span>
                ${isCurrentUser ? '<span class="nitro-badge-small">⭐</span>' : ''}
                <span class="message-time">${message.time}</span>
            </div>
            <div class="message-text">${escapeHtml(message.text)}</div>
        </div>
    `;
    
    messagesDiv.appendChild(messageEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    // Звуковое уведомление
    if (message.userId !== currentUser?.id && document.getElementById('soundNotif')?.checked) {
        playNotificationSound();
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

function playNotificationSound() {
    // Простой звуковой сигнал
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function selectServer(index) {
    const servers = document.querySelectorAll('.server');
    servers.forEach((s, i) => {
        s.classList.toggle('active', i === index);
    });
}

function selectChannel(index) {
    const channels = document.querySelectorAll('.channel:not(.voice)');
    channels.forEach((c, i) => {
        c.classList.toggle('active', i === index);
    });
    
    const channelNames = ['общий', 'новости', 'акции'];
    document.querySelector('.channel-name').textContent = `# ${channelNames[index]}`;
}

// Голосовая комната
let audioStream = null;
let isInVoiceChannel = false;
let audioContext = null;
let analyser = null;
let microphone = null;

async function toggleVoiceChannel() {
    if (!isInVoiceChannel) {
        await joinVoiceChannel();
    } else {
        leaveVoiceChannel();
    }
}

async function joinVoiceChannel() {
    try {
        // Запрос доступа к микрофону
        audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        isInVoiceChannel = true;
        
        // Создаем аудио контекст для визуализации
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(audioStream);
        
        analyser.fftSize = 256;
        microphone.connect(analyser);
        
        // Обновляем UI
        updateVoiceChannelUI();
        
        // Показываем панель управления голосом
        document.getElementById('voiceSettings').classList.add('active');
        
        // Добавляем пользователя в список голосовой комнаты
        addToVoiceChannel(currentUser.username);
        
        // Отправляем уведомление на сервер
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'voiceJoin'
            }));
        }
        
        // Запускаем визуализацию
        visualizeAudio();
        
    } catch (error) {
        console.error('Ошибка доступа к микрофону:', error);
        alert('Не удалось получить доступ к микрофону. Проверьте разрешения браузера.');
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
    
    // Обновляем UI
    updateVoiceChannelUI();
    
    // Скрываем панель управления голосом
    document.getElementById('voiceSettings').classList.remove('active');
    
    // Удаляем из списка голосовой комнаты
    removeFromVoiceChannel(currentUser.username);
    
    // Отправляем уведомление на сервер
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

function addToVoiceChannel(username) {
    const voiceList = document.getElementById('voiceMembers');
    if (!voiceList) {
        // Создаем секцию для голосовых участников
        const membersList = document.getElementById('membersList');
        const voiceSection = document.createElement('div');
        voiceSection.innerHTML = `
            <div class="members-title" style="margin-top: 20px;">В ГОЛОСОВОЙ — <span id="voiceCount">0</span></div>
            <div id="voiceMembers"></div>
        `;
        membersList.parentElement.insertBefore(voiceSection, membersList);
    }
    
    const voiceMembers = document.getElementById('voiceMembers');
    const memberEl = document.createElement('div');
    memberEl.className = 'member voice-member';
    memberEl.id = `voice-${username}`;
    memberEl.innerHTML = `
        <span class="status speaking"></span>
        <span class="member-name">${username}</span>
        <span class="voice-controls">
            <span class="voice-icon">🎤</span>
        </span>
    `;
    voiceMembers.appendChild(memberEl);
    
    updateVoiceCount();
}

function removeFromVoiceChannel(username) {
    const memberEl = document.getElementById(`voice-${username}`);
    if (memberEl) {
        memberEl.remove();
    }
    updateVoiceCount();
}

function updateVoiceCount() {
    const voiceCount = document.getElementById('voiceCount');
    const voiceMembers = document.querySelectorAll('.voice-member');
    if (voiceCount) {
        voiceCount.textContent = voiceMembers.length;
    }
}

function visualizeAudio() {
    if (!analyser || !isInVoiceChannel) return;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    // Вычисляем средний уровень звука
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    
    // Обновляем индикатор говорения
    const voiceMember = document.getElementById(`voice-${currentUser.username}`);
    if (voiceMember) {
        const statusIndicator = voiceMember.querySelector('.status');
        if (average > 30) {
            statusIndicator.classList.add('speaking-active');
        } else {
            statusIndicator.classList.remove('speaking-active');
        }
    }
    
    requestAnimationFrame(visualizeAudio);
}

function toggleMute() {
    if (!audioStream) return;
    
    const audioTrack = audioStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    
    const voiceMember = document.getElementById(`voice-${currentUser.username}`);
    if (voiceMember) {
        const voiceIcon = voiceMember.querySelector('.voice-icon');
        voiceIcon.textContent = audioTrack.enabled ? '🎤' : '🔇';
    }
    
    addMessage({
        author: 'Система',
        text: `${currentUser.username} ${audioTrack.enabled ? 'включил' : 'выключил'} микрофон`,
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        isSystem: true
    });
}

function createServer() {
    const name = prompt('Введите название сервера:');
    if (name) {
        alert(`Сервер "${name}" создан!`);
    }
}

// Российские акции (демо данные)
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
    
    modal.classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Погода
const russianCities = {
    'Москва': { lat: 55.7558, lon: 37.6173 },
    'Санкт-Петербург': { lat: 59.9311, lon: 30.3609 },
    'Новосибирск': { lat: 55.0084, lon: 82.9357 },
    'Екатеринбург': { lat: 56.8389, lon: 60.6057 },
    'Казань': { lat: 55.8304, lon: 49.0661 },
    'Нижний Новгород': { lat: 56.2965, lon: 43.9361 },
    'Челябинск': { lat: 55.1644, lon: 61.4368 },
    'Самара': { lat: 53.2001, lon: 50.1500 },
    'Омск': { lat: 54.9885, lon: 73.3242 },
    'Ростов-на-Дону': { lat: 47.2357, lon: 39.7015 }
};

function showWeather() {
    document.getElementById('weather-modal').classList.add('active');
    loadWeather();
}

function loadWeather() {
    const city = document.getElementById('cityInput').value.trim();
    const weatherContent = document.getElementById('weatherContent');
    
    // Генерация реалистичного прогноза
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

// Настройки
function showSettings() {
    document.getElementById('settings-modal').classList.add('active');
}

function changeTheme() {
    const theme = document.getElementById('themeSelect').value;
    document.body.className = `theme-${theme}`;
    localStorage.setItem('theme', theme);
}

// Загрузка сохраненной темы
window.addEventListener('load', () => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.getElementById('themeSelect').value = savedTheme;
    document.body.className = `theme-${savedTheme}`;
});

// Закрытие модальных окон при клике вне их
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
}


// Аватары
let userAvatar = null;
let serverAvatars = {};
let groupAvatars = {};
let groups = [];
let currentGroupId = null;

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
            
            addMessage({
                author: 'Система',
                text: `${currentUser.username} обновил аватар! ⭐`,
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                isSystem: true
            });
        };
        reader.readAsDataURL(file);
    }
}

function updateUserAvatar() {
    const profileAvatar = document.getElementById('profileAvatar');
    if (userAvatar) {
        profileAvatar.style.backgroundImage = `url(${userAvatar})`;
        profileAvatar.style.backgroundSize = 'cover';
        profileAvatar.style.backgroundPosition = 'center';
        profileAvatar.querySelector('span').style.display = 'none';
    }
}

function changeServerAvatar() {
    document.getElementById('serverAvatarInput').click();
}

function handleServerAvatarUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const serverId = 'main-server';
            serverAvatars[serverId] = e.target.result;
            localStorage.setItem('serverAvatars', JSON.stringify(serverAvatars));
            updateServerAvatar(serverId);
            
            addMessage({
                author: 'Система',
                text: 'Аватар сервера обновлен! 🎨',
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                isSystem: true
            });
        };
        reader.readAsDataURL(file);
    }
}

function updateServerAvatar(serverId) {
    const serverAvatar = document.getElementById('serverAvatar');
    const avatar = serverAvatars[serverId];
    
    if (avatar && serverAvatar) {
        serverAvatar.style.backgroundImage = `url(${avatar})`;
        serverAvatar.style.backgroundSize = 'cover';
        serverAvatar.style.backgroundPosition = 'center';
        serverAvatar.querySelector('span').style.display = 'none';
    }
    
    // Обновляем иконку сервера в списке
    const serverIcon = document.querySelector('.server.active');
    if (avatar && serverIcon) {
        serverIcon.style.backgroundImage = `url(${avatar})`;
        serverIcon.style.backgroundSize = 'cover';
        serverIcon.style.backgroundPosition = 'center';
        serverIcon.querySelector('span').style.display = 'none';
    }
}

function showServerSettings() {
    document.getElementById('server-settings-modal').classList.add('active');
    
    // Загружаем сохраненные данные
    const serverId = 'main-server';
    if (serverAvatars[serverId]) {
        updateServerAvatar(serverId);
    }
}

function saveServerSettings() {
    const newName = document.getElementById('serverNameInput').value.trim();
    if (newName) {
        document.getElementById('currentServerName').textContent = newName;
        document.getElementById('serverNameDisplay').textContent = newName;
        localStorage.setItem('serverName', newName);
        
        addMessage({
            author: 'Система',
            text: `Название сервера изменено на "${newName}"`,
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            isSystem: true
        });
    }
    closeModal('server-settings-modal');
}

// Группы
function showGroups() {
    document.getElementById('groups-modal').classList.add('active');
    loadGroups();
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
        
        addMessage({
            author: 'Система',
            text: `Группа "${name}" создана! 👥`,
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            isSystem: true
        });
    }
}

function openGroupSettings(groupId) {
    currentGroupId = groupId;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    document.getElementById('groupNameInput').value = group.name;
    document.getElementById('groupNameDisplay').textContent = group.name;
    
    // Обновляем аватар
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
    
    // Загружаем участников
    const membersList = document.getElementById('groupMembers');
    membersList.innerHTML = '';
    group.members.forEach(member => {
        const memberEl = document.createElement('div');
        memberEl.className = 'group-member-item';
        memberEl.innerHTML = `
            <span class="status online"></span>
            <span>${member}</span>
        `;
        membersList.appendChild(memberEl);
    });
    
    closeModal('groups-modal');
    document.getElementById('group-settings-modal').classList.add('active');
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
            
            const group = groups.find(g => g.id === currentGroupId);
            addMessage({
                author: 'Система',
                text: `Аватар группы "${group.name}" обновлен! 🎨`,
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                isSystem: true
            });
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
        
        addMessage({
            author: 'Система',
            text: `Настройки группы "${newName}" сохранены!`,
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            isSystem: true
        });
        
        closeModal('group-settings-modal');
        showGroups();
    }
}

// РусНитро
function showNitro() {
    document.getElementById('nitro-modal').classList.add('active');
    
    // Активируем РусНитро для всех россиян
    if (!localStorage.getItem('rusNitroActivated')) {
        localStorage.setItem('rusNitroActivated', 'true');
        
        addMessage({
            author: 'Система',
            text: `🎉 ${currentUser.username} активировал РусНитро! Все функции доступны бесплатно! ⭐`,
            time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
            isSystem: true
        });
    }
}

// Загрузка сохраненных данных при входе
function loadUserData() {
    // Загружаем аватар пользователя
    const savedAvatar = localStorage.getItem('userAvatar');
    if (savedAvatar) {
        userAvatar = savedAvatar;
        updateUserAvatar();
    }
    
    // Загружаем аватары серверов
    const savedServerAvatars = localStorage.getItem('serverAvatars');
    if (savedServerAvatars) {
        serverAvatars = JSON.parse(savedServerAvatars);
        updateServerAvatar('main-server');
    }
    
    // Загружаем аватары групп
    const savedGroupAvatars = localStorage.getItem('groupAvatars');
    if (savedGroupAvatars) {
        groupAvatars = JSON.parse(savedGroupAvatars);
    }
    
    // Загружаем название сервера
    const savedServerName = localStorage.getItem('serverName');
    if (savedServerName) {
        document.getElementById('currentServerName').textContent = savedServerName;
    }
    
    // Обновляем имя в профиле
    if (currentUser) {
        document.getElementById('profileName').textContent = currentUser.username;
        const avatarText = document.getElementById('profileAvatarText');
        if (avatarText) {
            avatarText.textContent = currentUser.username.charAt(0).toUpperCase();
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
    
    // Создаем модальное окно для ДМ если его нет
    let dmModal = document.getElementById('dm-modal');
    if (!dmModal) {
        createDMModal();
        dmModal = document.getElementById('dm-modal');
    }
    
    // Обновляем заголовок
    document.getElementById('dmUserName').textContent = username;
    
    // Очищаем сообщения
    const dmMessages = document.getElementById('dmMessages');
    dmMessages.innerHTML = '';
    
    // Загружаем историю сообщений
    if (dmConversations.has(username)) {
        dmConversations.get(username).forEach(msg => {
            displayPrivateMessage(msg.from, msg.text, msg.time);
        });
    }
    
    // Показываем модальное окно
    dmModal.classList.add('active');
    
    // Фокусируемся на поле ввода
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
    
    // Отправляем приватное сообщение на сервер
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
    // Показываем уведомление о новом сообщении
    const notification = document.createElement('div');
    notification.className = 'dm-notification';
    notification.innerHTML = `
        <strong>${username}</strong> отправил вам сообщение
        <button onclick="openDMWithUser('${username}')">Открыть</button>
    `;
    
    document.body.appendChild(notification);
    
    // Удаляем уведомление через 5 секунд
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Закрытие ДМ при клике вне модального окна
window.addEventListener('click', (event) => {
    const dmModal = document.getElementById('dm-modal');
    if (dmModal && event.target === dmModal) {
        closeDM();
    }
});
