const express = require('express');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
// 請確保環境變數已在 Render 設定
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new line.Client(lineConfig);

app.post('/callback', line.middleware(lineConfig), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== 'message') return;
  const userId = event.source.userId;

  // 1. 處理圖片：建立新草稿
  if (event.message.type === 'image') {
    const stream = await lineClient.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const fileName = `${userId}/${Date.now()}.jpg`;
    await supabase.storage.from('product-images').upload(fileName, buffer, { contentType: 'image/jpeg' });
    const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(fileName);

    // 初始化草稿，status 為 draft
    await supabase.from('products').insert([{ 
      image_url: publicUrl, 
      creator_id: userId, 
      status: 'draft',
      price: 0,
      quantity: 0
    }]);
    return lineClient.replyMessage(event.replyToken, { type: 'text', text: '照片已上傳！請輸入「商品名稱」：' });
  }

  // 2. 處理文字：依照狀態機流程更新
  if (event.message.type === 'text') {
    const { data: draft } = await supabase.from('products')
      .select('*').eq('creator_id', userId).eq('status', 'draft')
      .order('created_at', { ascending: false }).limit(1).single();

    if (!draft) return lineClient.replyMessage(event.replyToken, { type: 'text', text: '請先傳送圖片開始建立商品。' });

    // 依序檢查欄位，若為預設值或空值，則進行更新並提示下一步
    if (!draft.name) {
      await supabase.from('products').update({ name: event.message.text }).eq('id', draft.id);
      return lineClient.replyMessage(event.replyToken, { type: 'text', text: '收到名稱！請輸入「售價」：' });
    } 
    else if (draft.price === 0) {
      await supabase.from('products').update({ price: parseInt(event.message.text) }).eq('id', draft.id);
      return lineClient.replyMessage(event.replyToken, { type: 'text', text: '價格已更新，請輸入「數量」：' });
    } 
    else if (draft.quantity === 0) {
      await supabase.from('products').update({ quantity: parseInt(event.message.text) }).eq('id', draft.id);
      return lineClient.replyMessage(event.replyToken, { type: 'text', text: '數量已確認，請輸入「商品描述」：' });
    }
    else if (!draft.description) {
      await supabase.from('products').update({ description: event.message.text }).eq('id', draft.id);
      return lineClient.replyMessage(event.replyToken, { type: 'text', text: '描述已記錄，最後請輸入「備註」：' });
    }
    else {
      await supabase.from('products').update({ note: event.message.text, status: 'active' }).eq('id', draft.id);
      return lineClient.replyMessage(event.replyToken, { type: 'text', text: '✅ 商品已成功上架！' });
    }
  }
}

app.listen(process.env.PORT || 10000);
