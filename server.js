const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;

// Статические файлы
app.use(express.static(__dirname));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Хранилище подключенных клиентов с их данными
const clients = new Map();

// Хранилище серверов и каналов
const servers = new Map();
const channels = new Map();
const dmConversations = new Map();

// Инициализация дефолтного сервера
function initializeDefaultServer() {
    const defaultServer = {
        id: 'default-server',
        name: 'РусЧат Сервер',
        channels: ['general', 'news', 'stocks']
    };
    servers.set('default-server', defaultServer);
    
    // Создаем каналы
    channels.set('general', { id: 'general', name: 'общий', messages: [], serverId: 'default-server' });
    channels.set('news', { id: 'news', name: 'новости', messages: [], serverId: 'default-server' });
    channels.set('stocks', { id: 'stocks', name: 'акции', messages: [], serverId: 'default-server' });
}

initializeDefaultServer();

// Функция для получения списка онлайн пользователей
function getOnlineUsers() {
    const users = [];
    clients.forEach((userData) => {
        users.push({
            username: userData.username,
            phone: userData.phone,
            id: userData.id
        });
    });
    return users;
}

// Функция для поиска WebSocket клиента по username
function findClientByUsername(username) {
    for (let [ws, userData] of clients) {
        if (userData.username === username) {
            return ws;
        }
    }
    return null;
}

// Функция для отправки списка онлайн пользователей всем клиентам
function broadcastUserList() {
    const userList = getOnlineUsers();
    const message = JSON.stringify({
        type: 'userList',
        users: userList,
        count: userList.length
    });

    clients.forEach((userData, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

// WebSocket соединения
wss.on('connection', (ws) => {
    console.log('Новое подключение');
    let clientData = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Аутентификация пользователя
            if (data.type === 'auth') {
                if (!data.phone.startsWith('+7')) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Доступ разрешен только для российских пользователей'
                    }));
                    ws.close();
                    return;
                }

                clientData = {
                    username: data.username,
                    phone: data.phone,
                    id: data.id
                };

                clients.set(ws, clientData);
                console.log(`${data.username} присоединился к чату`);

                // Отправляем подтверждение
                ws.send(JSON.stringify({
                    type: 'authSuccess',
                    message: `Добро пожаловать, ${data.username}! 🇷🇺`
                }));

                // Отправляем текущий список пользователей
                ws.send(JSON.stringify({
                    type: 'userList',
                    users: getOnlineUsers(),
                    count: getOnlineUsers().length
                }));

                // Уведомляем всех о новом пользователе
                const joinMessage = JSON.stringify({
                    type: 'system',
                    author: 'Система',
                    text: `${data.username} присоединился к чату 👋`,
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                });

                clients.forEach((userData, client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(joinMessage);
                    }
                });

                // Обновляем список пользователей для всех
                broadcastUserList();
                return;
            }

            // Отправка сообщения в канал
            if (data.type === 'message' && clientData) {
                const channel = channels.get(data.channelId);
                if (channel) {
                    const message = {
                        author: clientData.username,
                        text: data.text,
                        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                        userId: clientData.id,
                        channelId: data.channelId
                    };
                    
                    channel.messages.push(message);
                    
                    const broadcast = JSON.stringify({
                        type: 'message',
                        ...message
                    });

                    clients.forEach((userData, client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(broadcast);
                        }
                    });
                }
            }

            // Создание нового сервера
            if (data.type === 'createServer' && clientData) {
                const serverId = `server-${Date.now()}`;
                const newServer = {
                    id: serverId,
                    name: data.serverName,
                    channels: ['general']
                };
                
                servers.set(serverId, newServer);
                channels.set(`${serverId}-general`, {
                    id: 'general',
                    name: 'общий',
                    messages: [],
                    serverId: serverId
                });
                
                const broadcast = JSON.stringify({
                    type: 'serverCreated',
                    server: newServer
                });
                
                clients.forEach((userData, client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(broadcast);
                    }
                });
            }

            // Приватное сообщение
            if (data.type === 'privateMessage' && clientData) {
                const recipientWs = findClientByUsername(data.recipientUsername);
                
                const privateMsg = JSON.stringify({
                    type: 'privateMessage',
                    from: clientData.username,
                    to: data.recipientUsername,
                    text: data.text,
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                    fromId: clientData.id
                });

                // Отправляем получателю
                if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                    recipientWs.send(privateMsg);
                }

                // Отправляем отправителю (для истории)
                ws.send(privateMsg);

                console.log(`Приватное сообщение: ${clientData.username} -> ${data.recipientUsername}`);
            }

            // Обновление статуса голосовой комнаты
            if (data.type === 'voiceJoin' && clientData) {
                const voiceMessage = JSON.stringify({
                    type: 'voiceJoin',
                    username: clientData.username,
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                });

                clients.forEach((userData, client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(voiceMessage);
                    }
                });
            }

            if (data.type === 'voiceLeave' && clientData) {
                const voiceMessage = JSON.stringify({
                    type: 'voiceLeave',
                    username: clientData.username,
                    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                });

                clients.forEach((userData, client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(voiceMessage);
                    }
                });
            }

        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    });

    ws.on('close', () => {
        if (clientData) {
            console.log(`${clientData.username} отключился`);
            
            // Уведомляем всех об отключении
            const leaveMessage = JSON.stringify({
                type: 'system',
                author: 'Система',
                text: `${clientData.username} покинул чат 👋`,
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
            });

            clients.forEach((userData, client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(leaveMessage);
                }
            });
        }

        clients.delete(ws);
        broadcastUserList();
    });

    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log('🇷🇺 РусЧат готов к работе!');
    console.log('Для остановки нажмите Ctrl+C');
});
