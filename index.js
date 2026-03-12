const express = require('express');
const cors = require('cors'); // 記得安裝: npm install cors
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- 1. Middleware 設定 (順序很重要) ---
app.use(cors()); // 允許跨域請求
app.use(express.json()); // 解析 JSON 格式請求
async function handleEvent(event) {
    // 過濾：只處理文字或圖片
    if (event.type !== 'message' || (event.message.type !== 'text' && event.message.type !== 'image')) return;
    
    const userId = event.source.userId;

    // 1. 優先處理「刪除指令」
    if (event.message.type === 'text' && event.message.text === '刪除最新商品') {
        // ... (保持你原本的刪除邏輯) ...
        return;
    }

    // 2. 處理「圖片上傳」
    if (event.message.type === 'image') {
        // ... (保持你原本的圖片上傳邏輯) ...
        return lineClient.replyMessage(event.replyToken, { type: 'text', text: '照片已接收！請輸入「品種」：' });
    }

    // --- 3. 核心修改：處理「文字輸入」前的檢查 ---
    // 先去資料庫撈看看有沒有該使用者的「草稿」
    const { data: draft } = await supabase
        .from('products')
        .select('*')
        .eq('creator_id', userId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    // 如果沒有草稿，卻收到了文字訊息，提示使用者先傳圖片
    if (!draft) {
        return lineClient.replyMessage(event.replyToken, { 
            type: 'text', 
            text: '您好！要上架商品請先「傳送一張商品照片」給我喔。' 
        });
    }

    // --- 4. 處理「填寫資料流程」 ---
    // (接續原本填寫品種、名稱、價格等流程...)
    const steps = [
        { key: 'category', msg: '收到品種！請輸入「名稱」：' },
        { key: 'name', msg: '收到名稱！請輸入「售價」：' },
        { key: 'price', msg: '價格已更新，請輸入「數量」：' },
        { key: 'quantity', msg: '數量已確認，請輸入「商品描述」：' },
        { key: 'description', msg: '描述已記錄，最後請輸入「備註」：' }
    ];

    for (let step of steps) {
        // 判斷當前該填哪一個欄位
        if (!draft[step.key] || draft[step.key] === 0 || draft[step.key] === '') {
            let updateVal = {};
            // 如果是價格或數量，轉成數字，否則維持字串
            updateVal[step.key] = (step.key === 'price' || step.key === 'quantity') 
                ? parseInt(event.message.text) 
                : event.message.text;

            await supabase.from('products').update(updateVal).eq('id', draft.id);
            return lineClient.replyMessage(event.replyToken, { type: 'text', text: step.msg });
        }
    }

    // 全部填寫完畢，更新為上架狀態
    await supabase.from('products').update({ note: event.message.text, status: 'active' }).eq('id', draft.id);
    return lineClient.replyMessage(event.replyToken, { type: 'text', text: '✅ 上架成功！您可以開始繼續傳送下一張照片來上架新商品。' });
}
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
