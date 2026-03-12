const express = require('express');
const cors = require('cors'); // 記得要安裝: npm install cors
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- 1. 重要設定：必須在路由之前 ---
app.use(cors()); // 允許跨來源請求 (解決 fetch blocked by CORS policy)
app.use(express.json()); // 確保能正確解析前端傳來的 JSON

// --- 2. 初始化 ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const lineConfig = { 
    channelAccessToken: process.env.LINE_ACCESS_TOKEN, 
    channelSecret: process.env.LINE_CHANNEL_SECRET 
};
const lineClient = new line.Client(lineConfig);

// --- 3. 路由 ---
app.post('/callback', line.middleware(lineConfig), async (req, res) => {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).send('OK');
});

// 接收來自 index.html 的訂單
app.post('/order', async (req, res) => {
    try {
        const { name, phone, items, total } = req.body;
        
        // 整理訊息內容
        const itemsText = items.map(i => `${i.name} x1`).join('\n');
        const message = `🔔 新訂單通知！\n\n顧客：${name}\n電話：${phone}\n\n購買清單：\n${itemsText}\n\n總金額：$${total}`;

        // 推播給管理者
        await lineClient.pushMessage(process.env.ADMIN_USER_ID, {
            type: 'text',
            text: message
        });

        res.status(200).send('Order Received');
    } catch (error) {
        console.error("訂單處理失敗:", error);
        res.status(500).send('Internal Server Error');
    }
});

// --- 4. 處理 LINE 訊息 (保持你原有的功能) ---
async function handleEvent(event) {
    if (event.type !== 'message' || (event.message.type !== 'text' && event.message.type !== 'image')) return;
    
    const userId = event.source.userId;

    // (這裡保留你原本的 handleEvent 邏輯...)
    // 記得如果這裡很長，請確保沒有重複的宣告
}

app.listen(process.env.PORT || 10000);
