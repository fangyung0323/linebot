const express = require('express');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const basicAuth = require('express-basic-auth');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new line.Client(lineConfig);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET
});

// 1. 健康檢查
app.get('/health', (req, res) => res.status(200).send('OK'));

// 2. LINE Webhook
app.post('/callback', line.middleware(lineConfig), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.json({ success: true });
  } catch (err) {
    res.status(500).end();
  }
});

// 3. 處理邏輯
async function handleEvent(event) {
  const userId = event.source.userId;

  // 處理圖片：建立新商品 (status: draft)
  if (event.type === 'message' && event.message.type === 'image') {
    const stream = await lineClient.getMessageContent(event.message.id);
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream({ folder: 'shop_items' }, (err, res) => err ? reject(err) : resolve(res));
      stream.pipe(uploadStream);
    });

    await supabase.from('products').insert([{ 
      image_url: result.secure_url, 
      creator_id: userId, 
      status: 'draft', 
      price: 0 
    }]);
    return lineClient.replyMessage(event.replyToken, { type: 'text', text: '照片已收到，請輸入售價：' });
  }

  // 處理文字：依照狀態填入資料
  if (event.type === 'message' && event.message.type === 'text') {
    const { data: draft } = await supabase.from('products')
      .select('*').eq('creator_id', userId).eq('status', 'draft').order('created_at', { ascending: false }).single();

    if (!draft) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '請先傳送圖片開始建立商品。' });

    if (draft.price === 0) {
      await supabase.from('products').update({ price: parseInt(event.message.text) }).eq('id', draft.id);
      return lineClient.replyMessage(event.replyToken, { type: 'text', text: '價格已更新，最後請輸入商品備註：' });
    } else {
      await supabase.from('products').update({ note: event.message.text, status: 'active' }).eq('id', draft.id);
      return lineClient.replyMessage(event.replyToken, { type: 'text', text: '✅ 商品已成功上架！' });
    }
  }
}

app.listen(process.env.PORT || 10000);
