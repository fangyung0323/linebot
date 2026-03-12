// 在 require 下方加入，測試環境變數是否讀得到
console.log("Supabase URL Check:", process.env.SUPABASE_URL ? "OK" : "MISSING");
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// 初始化 Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1. 訂單 Email 發送邏輯
app.post('/order', async (req, res) => {
    try {
        const { name, phone, email, items, total } = req.body;
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

        await axios.post('https://api.line.me/v2/bot/message/broadcast', 
            { messages: [{ type: 'text', text: message }] },
            { headers: { 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }}
        );
        res.status(200).send({ status: 'success' });
    } catch (error) {
        console.error('訂單失敗:', error.message);
        res.status(500).send({ status: 'error' });
    }
});

// 2. LINE Bot Webhook (處理圖片上傳)
app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.status(200).send('OK');

    for (const event of events) {
        if (event.type === 'message' && event.message.type === 'image') {
            try {
                // 取得圖片內容
                const imageRes = await axios.get(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, {
                    headers: { 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` },
                    responseType: 'arraybuffer'
                });

                // 上傳至 Supabase Storage
                const fileName = `public/${Date.now()}.jpg`;
                await supabase.storage.from('product-images').upload(fileName, imageRes.data, { contentType: 'image/jpeg' });
                const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(fileName);

                // 寫入資料庫
                await supabase.from('products').insert([{
                    name: '來自LINE的植物',
                    image_url: publicUrl,
                    creator_id: event.source.userId,
                    status: 'active',
                    price: 0,
                    quantity: 1
                }]);
                console.log('✅ 圖片上傳成功');
            } catch (err) {
                console.error('LINE圖片處理錯誤:', err.message);
            }
        }
    }
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
