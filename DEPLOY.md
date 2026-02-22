# Деплой РусЧата на Render

## Шаги:

1. **Создай GitHub репозиторий:**
   - Зайди на https://github.com/new
   - Назови его `ruschat`
   - Нажми "Create repository"

2. **Загрузи код на GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/ТВОЙ_ЮЗЕР/ruschat.git
   git push -u origin main
   ```

3. **Создай Web Service на Render:**
   - Зайди на https://render.com
   - Нажми "New +" → "Web Service"
   - Выбери "Connect a repository"
   - Выбери `ruschat`
   - Заполни:
     - **Name:** ruschat
     - **Runtime:** Node
     - **Build Command:** `npm install`
     - **Start Command:** `npm start`
     - **Plan:** Free
   - Нажми "Create Web Service"

4. **Готово!** Через 2-3 минуты получишь ссылку вроде:
   ```
   https://ruschat-xxxxx.onrender.com
   ```

Отправь эту ссылку другу и он сможет зайти!

## Локальный тест:
```bash
npm install
npm start
```
Откройся на http://localhost:3000
