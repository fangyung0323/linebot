const express = require('express');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const lineConfig = { channelAccessToken: process.env.LINE_ACCESS_TOKEN, channelSecret: process.env.LINE_CHANNEL_SECRET };
const lineClient = new line.Client(lineConfig);

app.post('/callback', line.middleware(lineConfig), async (req, res) => {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).send('OK');
});

async function handleEvent(event) {
    // 統一的過濾器：只處理文字或圖片
    if (event.type !== 'message' || (event.message.type !== 'text' && event.message.type !== 'image')) return;
    
    const userId = event.source.userId;

    // 1. 優先處理「刪除指令」(必須是文字才能判斷)
    if (event.message.type === 'text' && event.message.text === '刪除最新商品') {
        const { data: latest } = await supabase
            .from('products')
            .select('id')
            .eq('creator_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (latest) {
            await supabase.from('products').delete().eq('id', latest.id);
            return lineClient.replyMessage(event.replyToken, { type: 'text', text: '🗑️ 已成功刪除最新一筆商品紀錄！' });
        } else {
            return lineClient.replyMessage(event.replyToken, { type: 'text', text: '目前沒有任何商品可以刪除。' });
        }
    }

    // 2. 處理「圖片上傳」
    if (event.message.type === 'image') {
        const stream = await lineClient.getMessageContent(event.message.id);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const fileName = `${userId}/${Date.now()}.jpg`;
        await supabase.storage.from('product-images').upload(fileName, buffer);
        const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(fileName);
        await supabase.from('products').insert([{ image_url: publicUrl, creator_id: userId, status: 'draft', price: 0, quantity: 0 }]);
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: '照片已接收！請輸入「品種」(鹿角蕨/積水鳳梨/其他植物)：' });
    }

    // 3. 處理「填寫資料流程」
    const { data: draft } = await supabase.from('products').select('*').eq('creator_id', userId).eq('status', 'draft').order('created_at', { ascending: false }).limit(1).single();
    if (!draft) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '請先傳送圖片。' });

    const steps = [
        { key: 'category', msg: '收到品種！請輸入「名稱」：' },
        { key: 'name', msg: '收到名稱！請輸入「售價」：' },
        { key: 'price', msg: '價格已更新，請輸入「數量」：' },
        { key: 'quantity', msg: '數量已確認，請輸入「商品描述」：' },
        { key: 'description', msg: '描述已記錄，最後請輸入「備註」：' }
    ];

    for (let step of steps) {
        if (!draft[step.key] || draft[step.key] === 0) {
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
