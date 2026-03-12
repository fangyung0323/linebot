const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const app = express();
app.use(cors());
app.use(bodyParser.json());

// 記憶體中的狀態：{ userId: { step: '...', data: {} } }
const userState = {};

// 1. 訂單 Email 發送邏輯 (不變)
app.post('/order', async (req, res) => {
    try {
        const { name, phone, email, items, total } = req.body;
        const itemList = items.map(i => `${i.name} x ${i.quantity} ($${i.price * i.quantity})`).join('\n');
        const message = `🌿 新訂單通知！\n👤 ${name}\n📞 ${phone}\n📧 ${email}\n🛒 內容：\n${itemList}\n💰 總金額：$${total}`;
        
        await axios.post('https://api.line.me/v2/bot/message/broadcast', 
            { messages: [{ type: 'text', text: message }] },
            { headers: { 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` } }
        );
        res.status(200).send({ status: 'success' });
    } catch (error) { res.status(500).send({ status: 'error' }); }
});

// 2. LINE Webhook (圖片上傳 + 互動式狀態管理)
app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.status(200).send('OK');

    for (const event of events) {
        const userId = event.source.userId;
        const replyToken = event.replyToken;

        // 【步驟一：收到圖片】
        if (event.type === 'message' && event.message.type === 'image') {
            const imageRes = await axios.get(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, {
                headers: { 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` },
                responseType: 'arraybuffer'
            });
            const fileName = `public/${Date.now()}.jpg`;
            await supabase.storage.from('product-images').upload(fileName, imageRes.data, { contentType: 'image/jpeg' });
            const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(fileName);
            
            userState[userId] = { step: 'WAIT_NAME', data: { image_url: publicUrl, creator_id: userId } };
            await replyMessage(replyToken, "收到照片！請輸入【品名】");
        } 
        // 【步驟二：接收文字輸入並更新狀態】
        else if (event.type === 'message' && event.message.type === 'text' && userState[userId]) {
            const state = userState[userId];
            const text = event.message.text;

            if (state.step === 'WAIT_NAME') {
                state.data.name = text;
                state.step = 'WAIT_PRICE';
                await replyMessage(replyToken, "收到品名，請輸入【價格】");
            } else if (state.step === 'WAIT_PRICE') {
                state.data.price = parseInt(text);
                state.step = 'WAIT_QTY';
                await replyMessage(replyToken, "收到價格，請輸入【庫存數量】");
            } else if (state.step === 'WAIT_QTY') {
                state.data.quantity = parseInt(text);
                state.step = 'WAIT_NOTE';
                await replyMessage(replyToken, "收到庫存，最後請輸入【備註】");
            } else if (state.step === 'WAIT_NOTE') {
                state.data.note = text;
                // 完成！寫入資料庫
                await supabase.from('products').insert([state.data]);
                delete userState[userId];
                await replyMessage(replyToken, "✅ 上架成功！");
            }
        }
    }
    res.status(200).send('OK');
});

async function replyMessage(token, text) {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
        replyToken: token, messages: [{ type: 'text', text: text }]
    }, { headers: { 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` } });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
