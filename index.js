const express = require('express');
const cors = require('cors');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const lineConfig = { 
    channelAccessToken: process.env.LINE_ACCESS_TOKEN, 
    channelSecret: process.env.LINE_CHANNEL_SECRET 
};
const lineClient = new line.Client(lineConfig);

// --- 1. LINE Webhook (必須放在 express.json 之前) ---
app.post('/callback', line.middleware(lineConfig), async (req, res) => {
    try {
        await Promise.all(req.body.events.map(handleEvent));
        res.status(200).send('OK');
    } catch (err) {
        console.error("Callback Error:", err);
        res.status(500).end();
    }
});

// --- 2. 訂單與 API 路由 (之後才解析 JSON) ---
app.use(express.json());
app.use(cors());

app.post('/order', async (req, res) => {
    try {
        const { name, phone, items, total } = req.body;
        
        // 自動扣除庫存邏輯
        for (const item of items) {
            const { data: product } = await supabase.from('products').select('quantity').eq('id', item.id).single();
            if (product && product.quantity > 0) {
                await supabase.from('products').update({ quantity: product.quantity - 1 }).eq('id', item.id);
            } else {
                return res.status(400).send(`商品 ${item.name} 已售完`);
            }
        }

        // 推播通知
        const adminId = process.env.ADMIN_USER_ID;
        const itemsText = items.map(i => `${i.name} x1`).join('\n');
        await lineClient.pushMessage(adminId, [{ type: 'text', text: `🔔 新訂單！\n顧客：${name}\n電話：${phone}\n\n清單：\n${itemsText}\n總金額：$${total}` }]);
        
        res.status(200).send('Order Received');
    } catch (error) {
        res.status(500).send('Error');
    }
});

// --- 3. 核心上架邏輯 (handleEvent) ---
async function handleEvent(event) {
    if (event.type !== 'message' || (event.message.type !== 'text' && event.message.type !== 'image')) return;
    
    const userId = event.source.userId;

    // 處理圖片上傳
    if (event.message.type === 'image') {
        const stream = await lineClient.getMessageContent(event.message.id);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const fileName = `${userId}/${Date.now()}.jpg`;
        await supabase.storage.from('product-images').upload(fileName, buffer);
        const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(fileName);
        
        await supabase.from('products').insert([{ 
            image_url: publicUrl, 
            creator_id: userId, 
            status: 'draft', 
            price: 0, 
            quantity: 1 // 預設庫存 1
        }]);
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: '照片已接收！請輸入「品種」：' });
    }

    // 處理文字資料填寫
    const { data: draft } = await supabase.from('products').select('*').eq('creator_id', userId).eq('status', 'draft').order('created_at', { ascending: false }).limit(1).single();
    if (!draft) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '請先「傳送一張商品照片」開始上架。' });

    const steps = [
        { key: 'category', msg: '收到品種！請輸入「名稱」：' },
        { key: 'name', msg: '收到名稱！請輸入「售價」：' },
        { key: 'price', msg: '價格已更新，請輸入「數量」：' },
        { key: 'quantity', msg: '數量已確認，最後請輸入「備註」：' }
    ];

    for (let step of steps) {
        if (!draft[step.key] || draft[step.key] === 0 || draft[step.key] === '') {
            let updateVal = {};
            updateVal[step.key] = (step.key === 'price' || step.key === 'quantity') ? parseInt(event.message.text) : event.message.text;
            await supabase.from('products').update(updateVal).eq('id', draft.id);
            return lineClient.replyMessage(event.replyToken, { type: 'text', text: step.msg });
        }
    }

    await supabase.from('products').update({ status: 'active' }).eq('id', draft.id);
    return lineClient.replyMessage(event.replyToken, { type: 'text', text: '✅ 上架成功！' });
}

app.listen(process.env.PORT || 10000);
