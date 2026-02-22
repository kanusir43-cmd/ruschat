const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Статические файлы
app.use(express.static(__dirname));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Хранилище данных
const clients = new Map();
const servers = new Map();
const channels = new Map();
const voiceRooms = new Map();
const rateLimits = new Map(); // Защита от спама
const serverAvatars = new Map(); // Аватарки серверов
const userAvatars = new Map(); // Аватарки пользователей

// Константы для rate limiting
const RATE_LIMIT = {
    messages: 5, // максимум сообщений
    timeWindow: 5000, // за 5 секунд
    banTime: 30000 // бан на 30 секунд
};

// Инициализация дефолтного сервера
function initializeDefaultServer() {
    const defaultServer = {
        id: 'default-server',
        name: 'РусЧат Сервер',
        textChannels: ['general', 'random', 'memes'],
        voiceChannels: ['voice-1', 'voice-2']
    };
    servers.set('default-server', defaultServer);
    
    // Текстовые каналы
    channels.set('default-server-general', { 
        id: 'general', 
        name: 'общий', 
        type: 'text',
        messages: [], 
        serverId: 'default-server' 
    });
    channels.set('default-server-random', { 
        id: 'random', 
        name: 'случайное', 
        type: 'text',
        messages: [], 
        serverId: 'default-server' 
    });
    channels.set('default-server-memes', { 
        id: 'memes', 
        name: 'мемы', 
        type: 'text',
        messages: [], 
        serverId: 'default-server' 
    });
    
    // Голосовые каналы
    voiceRooms.set('default-server-voice-1', {
        id: 'voice-1',
        name: 'Общая комната',
        serverId: 'default-server',
        members: []
    });
    voiceRooms.set('default-server-voice-2', {
        id: 'voice-2',
        name: 'Игровая',
        serverId: 'default-server',
        members: []
    });
}

initializeDefaultServer();

// Утилиты
function getOnlineUsers() {
    const users = [];
    clients.forEach((userData) => {
        users.push({
            username: userData.username,
            phone: userData.phone,
            id: userData.id,
            voiceChannel: userData.voiceChannel || null,
            avatar: userAvatars.get(userData.username) || null
        });
    });
    return users;
}

function checkRateLimit(userId) {
    const now = Date.now();
    
    if (!rateLimits.has(userId)) {
        rateLimits.set(userId, {
            messages: [],
            banned: false,
            banUntil: 0
        });
    }
    
    const userLimit = rateLimits.get(userId);
    
    // Проверяем, не забанен ли пользователь
    if (userLimit.banned && now < userLimit.banUntil) {
        return { allowed: false, reason: 'Вы забанены за спам. Попробуйте позже.' };
    }
    
    if (userLimit.banned && now >= userLimit.banUntil) {
        userLimit.banned = false;
        userLimit.messages = [];
    }
    
    // Удаляем старые сообщения за пределами временного окна
    userLimit.messages = userLimit.messages.filter(time => now - time < RATE_LIMIT.timeWindow);
    
    // Проверяем лимит
    if (userLimit.messages.length >= RATE_LIMIT.messages) {
        userLimit.banned = true;
        userLimit.banUntil = now + RATE_LIMIT.banTime;
        userLimit.messages = [];
        return { allowed: false, reason: 'Слишком много сообщений. Вы забанены на 30 секунд.' };
    }
    
    // Добавляем текущее сообщение
    userLimit.messages.push(now);
    return { allowed: true };
}

function findClientByUsername(username) {
    for (let [ws, userData] of clients) {
        if (userData.username === username) {
            return ws;
        }
    }
    return null;
}

function broadcastToServer(serverId, message) {
    clients.forEach((userData, client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

function broadcastUserList() {
    const userList = getOnlineUsers();
    const message = {
        type: 'userList',
        users: userList,
        count: userList.length
    };

    clients.forEach((userData, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    });
}

// WebSocket соединения
wss.on('connection', (ws) => {
    console.log('🔌 Новое подключение');
    let clientData = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Аутентификация
            if (data.type === 'auth') {
                if (!data.phone.startsWith('+7')) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Доступ разрешен только для российских пользователей'
                    }));
                    ws.close();
                    return;
                }

                // Проверяем, не подключен ли уже этот пользователь
                for (let [existingWs, existingData] of clients) {
                    if (existingData.username === data.username) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Этот аккаунт уже подключен'
                        }));
                        ws.close();
                        return;
                    }
                }

                clientData = {
                    username: data.username,
                    phone: data.phone,
                    id: data.id,
                    voiceChannel: null
                };

                clients.set(ws, clientData);
                console.log(`✅ ${data.username} присоединился`);

                // Отправляем структуру серверов
                const serversList = [];
                servers.forEach((server, serverId) => {
                    const textChannels = [];
                    const voiceChannels = [];
                    
                    server.textChannels.forEach(channelId => {
                        const channel = channels.get(`${serverId}-${channelId}`);
                        if (channel) {
                            textChannels.push({
                                id: channelId,
                                name: channel.name,
                                type: 'text'
                            });
                        }
                    });
                    
                    server.voiceChannels.forEach(channelId => {
                        const room = voiceRooms.get(`${serverId}-${channelId}`);
                        if (room) {
                            voiceChannels.push({
                                id: channelId,
                                name: room.name,
                                type: 'voice',
                                members: room.members
                            });
                        }
                    });
                    
                    serversList.push({
                        id: serverId,
                        name: server.name,
                        textChannels,
                        voiceChannels
                    });
                });

                ws.send(JSON.stringify({
                    type: 'authSuccess',
                    servers: serversList
                }));

                broadcastUserList();
                return;
            }

            if (!clientData) return;

            // Отправка сообщения в канал
            if (data.type === 'message') {
                // Проверка rate limit
                const rateCheck = checkRateLimit(clientData.id);
                if (!rateCheck.allowed) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: rateCheck.reason
                    }));
                    return;
                }
                
                const channel = channels.get(`${data.serverId}-${data.channelId}`);
                if (channel) {
                    const message = {
                        author: clientData.username,
                        text: data.text,
                        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                        userId: clientData.id,
                        channelId: data.channelId,
                        serverId: data.serverId
                    };
                    
                    channel.messages.push(message);
                    
                    broadcastToServer(data.serverId, {
                        type: 'message',
                        ...message
                    });
                }
            }

            // Создание сервера
            if (data.type === 'createServer') {
                const serverId = `server-${Date.now()}`;
                const newServer = {
                    id: serverId,
                    name: data.serverName,
                    textChannels: ['general'],
                    voiceChannels: ['voice-1']
                };
                
                servers.set(serverId, newServer);
                
                channels.set(`${serverId}-general`, {
                    id: 'general',
                    name: 'общий',
                    type: 'text',
                    messages: [],
                    serverId: serverId
                });
                
                voiceRooms.set(`${serverId}-voice-1`, {
                    id: 'voice-1',
                    name: 'Голосовая',
                    serverId: serverId,
                    members: []
                });
                
                broadcastToServer(serverId, {
                    type: 'serverCreated',
                    server: {
                        id: serverId,
                        name: newServer.name,
                        textChannels: [{
                            id: 'general',
                            name: 'общий',
                            type: 'text'
                        }],
                        voiceChannels: [{
                            id: 'voice-1',
                            name: 'Голосовая',
                            type: 'voice',
                            members: []
                        }]
                    }
                });
            }

            // Создание канала
            if (data.type === 'createChannel') {
                const server = servers.get(data.serverId);
                if (server) {
                    const channelId = `channel-${Date.now()}`;
                    
                    if (data.channelType === 'text') {
                        server.textChannels.push(channelId);
                        channels.set(`${data.serverId}-${channelId}`, {
                            id: channelId,
                            name: data.channelName,
                            type: 'text',
                            messages: [],
                            serverId: data.serverId
                        });
                    } else {
                        server.voiceChannels.push(channelId);
                        voiceRooms.set(`${data.serverId}-${channelId}`, {
                            id: channelId,
                            name: data.channelName,
                            serverId: data.serverId,
                            members: []
                        });
                    }
                    
                    broadcastToServer(data.serverId, {
                        type: 'channelCreated',
                        serverId: data.serverId,
                        channel: {
                            id: channelId,
                            name: data.channelName,
                            type: data.channelType,
                            members: []
                        }
                    });
                }
            }

            // Удаление канала
            if (data.type === 'deleteChannel') {
                const server = servers.get(data.serverId);
                if (server) {
                    if (data.channelType === 'text') {
                        server.textChannels = server.textChannels.filter(id => id !== data.channelId);
                        channels.delete(`${data.serverId}-${data.channelId}`);
                    } else {
                        server.voiceChannels = server.voiceChannels.filter(id => id !== data.channelId);
                        voiceRooms.delete(`${data.serverId}-${data.channelId}`);
                    }
                    
                    broadcastToServer(data.serverId, {
                        type: 'channelDeleted',
                        serverId: data.serverId,
                        channelId: data.channelId,
                        channelType: data.channelType
                    });
                }
            }

            // Переименование канала
            if (data.type === 'renameChannel') {
                if (data.channelType === 'text') {
                    const channel = channels.get(`${data.serverId}-${data.channelId}`);
                    if (channel) {
                        channel.name = data.newName;
                    }
                } else {
                    const room = voiceRooms.get(`${data.serverId}-${data.channelId}`);
                    if (room) {
                        room.name = data.newName;
                    }
                }
                
                broadcastToServer(data.serverId, {
                    type: 'channelRenamed',
                    serverId: data.serverId,
                    channelId: data.channelId,
                    channelType: data.channelType,
                    newName: data.newName
                });
            }

            // Присоединение к голосовому каналу
            if (data.type === 'voiceJoin') {
                const roomKey = `${data.serverId}-${data.channelId}`;
                const room = voiceRooms.get(roomKey);
                
                if (room) {
                    // Удаляем из предыдущей комнаты
                    if (clientData.voiceChannel) {
                        const oldRoom = voiceRooms.get(clientData.voiceChannel);
                        if (oldRoom) {
                            oldRoom.members = oldRoom.members.filter(m => m !== clientData.username);
                        }
                    }
                    
                    // Добавляем в новую
                    if (!room.members.includes(clientData.username)) {
                        room.members.push(clientData.username);
                    }
                    clientData.voiceChannel = roomKey;
                    
                    broadcastToServer(data.serverId, {
                        type: 'voiceUpdate',
                        serverId: data.serverId,
                        channelId: data.channelId,
                        members: room.members
                    });
                    
                    broadcastUserList();
                }
            }

            // Выход из голосового канала
            if (data.type === 'voiceLeave') {
                if (clientData.voiceChannel) {
                    const room = voiceRooms.get(clientData.voiceChannel);
                    if (room) {
                        room.members = room.members.filter(m => m !== clientData.username);
                        
                        broadcastToServer(room.serverId, {
                            type: 'voiceUpdate',
                            serverId: room.serverId,
                            channelId: room.id,
                            members: room.members
                        });
                    }
                    clientData.voiceChannel = null;
                    broadcastUserList();
                }
            }

            // WebRTC сигналинг
            if (data.type === 'webrtc-offer' || data.type === 'webrtc-answer' || data.type === 'webrtc-ice') {
                const targetWs = findClientByUsername(data.target);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify({
                        ...data,
                        from: clientData.username
                    }));
                }
            }

            // Приватные сообщения
            if (data.type === 'privateMessage') {
                const recipientWs = findClientByUsername(data.recipientUsername);
                
                const privateMsg = {
                    type: 'privateMessage',
                    from: clientData.username,
                    to: data.recipientUsername,
                    text: data.text,
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                    fromId: clientData.id
                };

                if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                    recipientWs.send(JSON.stringify(privateMsg));
                }

                ws.send(JSON.stringify(privateMsg));
            }

            // Обновление аватара пользователя
            if (data.type === 'userAvatarUpdate') {
                userAvatars.set(clientData.username, data.avatar);
                broadcastUserList();
            }

        } catch (error) {
            console.error('❌ Ошибка обработки сообщения:', error);
        }
    });

    ws.on('close', () => {
        if (clientData) {
            console.log(`👋 ${clientData.username} отключился`);
            
            // Удаляем из голосовой комнаты
            if (clientData.voiceChannel) {
                const room = voiceRooms.get(clientData.voiceChannel);
                if (room) {
                    room.members = room.members.filter(m => m !== clientData.username);
                    broadcastToServer(room.serverId, {
                        type: 'voiceUpdate',
                        serverId: room.serverId,
                        channelId: room.id,
                        members: room.members
                    });
                }
            }
        }

        clients.delete(ws);
        broadcastUserList();
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket ошибка:', error);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log('🇷🇺 РусЧат готов к работе!');
});
