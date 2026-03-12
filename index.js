const express = require('express');
const cors = require('cors');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- 1. 初始化 ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const lineConfig = { 
    channelAccessToken: process.env.LINE_ACCESS_TOKEN, 
    channelSecret: process.env.LINE_CHANNEL_SECRET 
};
const lineClient = new line.Client(lineConfig);

// --- 2. LINE Webhook 專用路由 (必須在 express.json 之前) ---
// 這樣 line.middleware 才能正確驗證原始請求的簽名
app.post('/callback', line.middleware(lineConfig), async (req, res) => {
    try {
        await Promise.all(req.body.events.map(handleEvent));
        res.status(200).send('OK');
    } catch (err) {
        console.error("Callback 處理錯誤:", err);
        res.status(500).end();
    }
});

// --- 3. 其他路由與 API 設定 ---
// 從這裡開始，才啟用 JSON 解析與 CORS，這樣就不會干擾到上面的 Webhook
app.use(express.json());
app.use(cors());

app.post('/order', async (req, res) => {
    try {
        const { name, phone, items, total } = req.body;
        const adminId = process.env.ADMIN_USER_ID;
        
        await lineClient.pushMessage(adminId, [{
            type: 'text',
            text: `🔔 新訂單通知！\n\n顧客：${name}\n電話：${phone}\n\n總金額：$${total}`
        }]);
        res.status(200).send('Order Received');
    } catch (error) {
        console.error("訂單處理失敗:", error);
        res.status(500).send('Internal Server Error');
    }
});

// --- 4. 核心邏輯：處理 LINE 訊息 ---
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
        await supabase.from('products').insert([{ image_url: publicUrl, creator_id: userId, status: 'draft', price: 0, quantity: 0 }]);
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: '照片已接收！請輸入「品種」：' });
    }

    // 檢查是否有草稿
    const { data: draft } = await supabase.from('products').select('*').eq('creator_id', userId).eq('status', 'draft').order('created_at', { ascending: false }).limit(1).single();
    
    if (!draft) {
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: '您好！要上架商品請先「傳送一張商品照片」。' });
    }

    // 填寫欄位流程
    const steps = [
        { key: 'category', msg: '收到品種！請輸入「名稱」：' },
        { key: 'name', msg: '收到名稱！請輸入「售價」：' },
        { key: 'price', msg: '價格已更新，請輸入「數量」：' },
        { key: 'quantity', msg: '數量已確認，請輸入「商品描述」：' },
        { key: 'description', msg: '描述已記錄，最後請輸入「備註」：' }
    ];

    for (let step of steps) {
        if (!draft[step.key] || draft[step.key] === 0 || draft[step.key] === '') {
            let updateVal = {};
            updateVal[step.key] = (step.key === 'price' || step.key === 'quantity') ? parseInt(event.message.text) : event.message.text;
            await supabase.from('products').update(updateVal).eq('id', draft.id);
            return lineClient.replyMessage(event.replyToken, { type: 'text', text: step.msg });
        }
    }

    await supabase.from('products').update({ note: event.message.text, status: 'active' }).eq('id', draft.id);
    return lineClient.replyMessage(event.replyToken, { type: 'text', text: '✅ 上架成功！' });
}

app.listen(process.env.PORT || 10000);
