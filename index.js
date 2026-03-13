const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const app = express();
app.use(cors());
app.use(bodyParser.json());

const userState = {}; // 記憶體狀態儲存

// 1. 訂單發送功能
app.post('/order', async (req, res) => {
    try {
        const { name, phone, email, items, total } = req.body;

        // 1. 遍歷購物車商品並更新資料庫庫存
        for (const item of items) {
            // 先取得目前該商品的剩餘數量
            const { data: product, error: fetchError } = await supabase
                .from('products')
                .select('quantity')
                .eq('id', item.id)
                .single();

            if (fetchError || !product) throw new Error(`找不到商品: ${item.name}`);

            const newQuantity = product.quantity - item.quantity;
            
            // 如果庫存不足，則中斷訂單 (防呆機制)
            if (newQuantity < 0) throw new Error(`${item.name} 庫存不足`);

            // 更新資料庫
            const { error: updateError } = await supabase
                .from('products')
                .update({ quantity: newQuantity })
                .eq('id', item.id);

            if (updateError) throw updateError;
        }

        // 2. 原本的 Line 通知邏輯
        const itemList = items.map(i => `${i.name} x ${i.quantity} ($${i.price * i.quantity})`).join('\n');
        const message = `🌿 新訂單通知！\n👤 ${name}\n📞 ${phone}\n📧 ${email}\n🛒 內容：\n${itemList}\n💰 總金額：$${total}`;
        
        await axios.post('https://api.line.me/v2/bot/message/broadcast', 
            { messages: [{ type: 'text', text: message }] },
            { headers: { 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` } }
        );

        res.status(200).send({ status: 'success' });
    } catch (error) {
        console.error("訂單處理錯誤:", error.message);
        res.status(500).send({ status: 'error', message: error.message });
    }
});

// 2. LINE Webhook 完整邏輯
app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.status(200).send('OK');

    for (const event of events) {
        const userId = event.source.userId;
        const replyToken = event.replyToken;

        // 【處理圖片：啟動上架】
        if (event.type === 'message' && event.message.type === 'image') {
            const imageRes = await axios.get(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, {
                headers: { 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` },
                responseType: 'arraybuffer'
            });
            const fileName = `public/${Date.now()}.jpg`;
            await supabase.storage.from('product-images').upload(fileName, imageRes.data, { contentType: 'image/jpeg' });
            const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(fileName);
            
            userState[userId] = { step: 'WAIT_CATEGORY', data: { image_url: publicUrl, creator_id: userId } };
            await replyMessage(replyToken, "收到照片！請輸入「品種」：");
        } 
        // 【處理文字：依序輸入】
        else if (event.type === 'message' && event.message.type === 'text' && userState[userId]) {
            const state = userState[userId];
            const text = event.message.text;

            if (state.step === 'WAIT_CATEGORY') {
                state.data.category = text;
                state.step = 'WAIT_NAME';
                await replyMessage(replyToken, "收到品種！請輸入「名稱」：");
            } else if (state.step === 'WAIT_NAME') {
                state.data.name = text;
                state.step = 'WAIT_PRICE';
                await replyMessage(replyToken, "收到名稱！請輸入「售價」：");
            } else if (state.step === 'WAIT_PRICE') {
                state.data.price = parseInt(text) || 0;
                state.step = 'WAIT_QUANTITY';
                await replyMessage(replyToken, "價格已更新，請輸入「數量」：");
            } else if (state.step === 'WAIT_QUANTITY') {
                state.data.quantity = parseInt(text) || 0;
                state.step = 'WAIT_DESCRIPTION';
                await replyMessage(replyToken, "數量已確認，請輸入「商品描述」：");
            } else if (state.step === 'WAIT_DESCRIPTION') {
                state.data.description = text;
                state.step = 'WAIT_NOTE';
                await replyMessage(replyToken, "描述已記錄，最後請輸入「備註」：");
            } else if (state.step === 'WAIT_NOTE') {
                state.data.note = text;
                const { error } = await supabase.from('products').insert([state.data]);
                
                if (error) {
                    console.error("DB Error:", error);
                    await replyMessage(replyToken, "上架失敗，請檢查欄位。");
                } else {
                    await replyMessage(replyToken, "✅ 上架成功！");
                }
                delete userState[userId];
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

app.listen(process.env.PORT || 3000, () => console.log('Server is running'));
