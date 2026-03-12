const express = require('express');
const cors = require('cors'); // 記得安裝: npm install cors
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- 1. Middleware 設定 (順序很重要) ---
app.use(cors()); // 允許跨域請求
app.use(express.json()); // 解析 JSON 格式請求

// --- 2. 初始化 ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const lineConfig = { 
    channelAccessToken: process.env.LINE_ACCESS_TOKEN, 
    channelSecret: process.env.LINE_CHANNEL_SECRET 
};
const lineClient = new line.Client(lineConfig);

// --- 3. 路由 ---
// LINE Bot 接收訊息用的 Callback
app.post('/callback', line.middleware(lineConfig), async (req, res) => {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).send('OK');
});

// 接收來自 index.html 的訂單
app.post('/order', async (req, res) => {
    try {
        const { name, phone, items, total } = req.body;
        const adminId = process.env.ADMIN_USER_ID;

        if (!adminId) {
            console.error("錯誤: 未設定 ADMIN_USER_ID");
            return res.status(500).send('伺服器設定錯誤');
        }

        // 整理訊息內容
        const itemsText = items.map(i => `${i.name} x1`).join('\n');
        const message = `🔔 新訂單通知！\n\n顧客：${name}\n電話：${phone}\n\n購買清單：\n${itemsText}\n\n總金額：$${total}`;

        // 使用正確的 API 參數：第一個是目標 ID，第二個是訊息物件陣列
        await lineClient.pushMessage(adminId, [
            {
                type: 'text',
                text: message
            }
        ]);

        console.log("訂單成功發送給:", adminId);
        res.status(200).send('Order Received');
    } catch (error) {
        console.error("訂單處理失敗:", error.originalError?.data || error);
        res.status(500).send('Internal Server Error');
    }
});

// --- 4. 處理 LINE 訊息邏輯 ---
async function handleEvent(event) {
    if (event.type !== 'message' || (event.message.type !== 'text' && event.message.type !== 'image')) return;
    
    const userId = event.source.userId;

    // ... (你原本處理商品上架與刪除的邏輯放這裡) ...
    // 請確保這裡面的變數宣告沒有重複
}

app.listen(process.env.PORT || 10000);
