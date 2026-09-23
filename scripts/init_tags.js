const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const col = mongoose.connection.collection('products');
    
    await col.updateOne({ name: 'Matcha & My Muse' }, { $set: { tag: 'Top Bán Chạy', tag_color: '#DC2626' } });
    await col.updateOne({ name: 'Scented Candle' }, { $set: { tag: 'Chỉ Còn 3 Hũ', tag_color: '#4A2C2A' } });
    await col.updateOne({ name: 'Moments Collection' }, { $set: { tag: 'Mới Ra Mắt', tag_color: '#CA8A04' } });
    await col.updateOne({ name: 'Love Whisper' }, { $set: { tag: 'Phiên Bản Giới Hạn', tag_color: '#5C1A22' } });

    console.log('Product tags initialized successfully');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
