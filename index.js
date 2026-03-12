const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

// 解決跨域問題 (CORS)
const cors = require('cors');
app.use(cors());
app.use(bodyParser.json());

// 1. 處理訂單 (結帳與 LINE 推送)
app.post('/order', async (req, res) => {
    try {
        const { name, phone, email, items, total } = req.body;
        
        // 格式化購物清單字串
        const itemList = items.map(i => `${i.name} x ${i.quantity} ($${i.price * i.quantity})`).join('\n');

        const message = `🌿 新訂單通知！
👤 姓名：${name}
📞 電話：${phone}
📧 Email：${email}
-----------------------
🛒 內容：
${itemList}
-----------------------
💰 總金額：$${total}
-----------------------
請儘速處理此訂單！`;

        // 發送到 LINE
        await axios.post('https://api.line.me/v2/bot/message/broadcast', 
            { messages: [{ type: 'text', text: message }] },
            { headers: { 
                'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`, 
                'Content-Type': 'application/json' 
            }}
        );
        
        res.status(200).send({ status: 'success' });
    } catch (error) {
        console.error('訂單發送失敗:', error.message);
        res.status(500).send({ status: 'error', message: error.message });
    }
});

// 2. 處理商品上架 (供 admin.html 使用)
app.post('/add-product', async (req, res) => {
    // 此端點主要用於記錄或日誌，實際寫入 Supabase 是由 admin.html 前端直接完成
    // 如果你有額外需要後端處理的邏輯，可寫在這裡
    res.status(200).send({ status: 'ready' });
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`伺服器運行中，監聽 port: ${PORT}`);
});
// ... 承接之前的 index.js ...

// 處理 LINE Bot 的訊息回傳 (Webhook)
app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    
    for (const event of events) {
        if (event.type === 'message' && event.message.type === 'image') {
            // 這裡原本是處理 LINE 圖片的邏輯
            // 確保你在這裡寫入 Supabase 時，補上 creator_id: event.source.userId
            await supabase.from('products').insert([{
                name: '來自LINE的植物',
                image_url: '...',
                creator_id: event.source.userId, // 確保這裡有值，就不會報 null 錯誤
                status: 'active'
            }]);
        }
    }
    res.status(200).send('OK');
});
