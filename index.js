const express = require('express');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();

// 初始化 Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new line.Client(lineConfig);

// 健康檢查
app.get('/health', (req, res) => res.status(200).send('OK'));

// LINE Webhook
app.post('/callback', line.middleware(lineConfig), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  const userId = event.source.userId;

  // --- 處理圖片：上傳至 Supabase Storage 並建立草稿 ---
  if (event.type === 'message' && event.message.type === 'image') {
    const stream = await lineClient.getMessageContent(event.message.id);
    
    // 將 Stream 轉為 Buffer 才能傳給 Supabase
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const fileName = `${userId}/${Date.now()}.jpg`;

    // 上傳到 Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(fileName, buffer, { contentType: 'image/jpeg' });

    if (uploadError) throw uploadError;

    // 取得公開網址
    const { data: { publicUrl } } = supabase.storage
      .from('product-images')
      .getPublicUrl(fileName);

    // 在資料庫建立草稿
    await supabase.from('products').insert([{ 
      image_url: publicUrl, 
      creator_id: userId, 
      status: 'draft',
      price: 0 
    }]);

    return lineClient.replyMessage(event.replyToken, { type: 'text', text: '照片已上傳！請輸入商品「售價」：' });
  }

  // --- 處理文字：填寫價格與備註 ---
  if (event.type === 'message' && event.message.type === 'text') {
    const { data: draft } = await supabase.from('products')
      .select('*')
      .eq('creator_id', userId)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!draft) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '請先傳送圖片來開始建立商品。' });

    if (draft.price === 0) {
      const price = parseInt(event.message.text);
      if (isNaN(price)) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '請輸入正確的數字金額喔！' });

      await supabase.from('products').update({ price: price }).eq('id', draft.id);
      return lineClient.replyMessage(event.replyToken, { type: 'text', text: '價格已設定！最後請輸入「商品備註」：' });
    } else {
      await supabase.from('products').update({ note: event.message.text, status: 'active' }).eq('id', draft.id);
      return lineClient.replyMessage(event.replyToken, { type: 'text', text: '✅ 商品已成功上架！您可以去購物車頁面查看了。' });
    }
  }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


    
  
