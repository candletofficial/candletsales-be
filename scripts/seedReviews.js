/**
 * Script tự động fake thêm đánh giá chất lượng cao cho các sản phẩm
 * ĐẢM BẢO TẤT CẢ SẢN PHẨM ĐỀU CÓ ĐIỂM SAO TRUNG BÌNH TRÊN 4.9 ⭐
 * Tối thiểu từ 6 đến 12 đánh giá/sản phẩm, văn phong cảm xúc, chân thực.
 * 
 * Chạy script: node scripts/seedReviews.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Product = require('../models/Product');
const User = require('../models/User');
const Review = require('../models/Review');

// Danh sách khách hàng đánh giá đa dạng, họ tên tiếng Việt tự nhiên
const FAKE_USERS = [
  { name: 'Nguyễn Quỳnh Anh', email: 'quynhanh.review@candlet.vn' },
  { name: 'Trần Minh Trí', email: 'minhtri.review@candlet.vn' },
  { name: 'Lê Thu Hà', email: 'thuha.review@candlet.vn' },
  { name: 'Phạm Hoàng Yến', email: 'hoangyen.review@candlet.vn' },
  { name: 'Vũ Đức Thắng', email: 'ducthang.review@candlet.vn' },
  { name: 'Đặng Phương Thảo', email: 'phuongthao.review@candlet.vn' },
  { name: 'Bùi Ngọc Mai', email: 'ngocmai.review@candlet.vn' },
  { name: 'Đỗ Quốc Khánh', email: 'quockhanh.review@candlet.vn' },
  { name: 'Hoàng Bích Trâm', email: 'bichtram.review@candlet.vn' },
  { name: 'Ngô Thanh Hương', email: 'thanhhuong.review@candlet.vn' },
  { name: 'Võ Gia Huy', email: 'giahuy.review@candlet.vn' },
  { name: 'Phan Thùy Linh', email: 'thuylinh.review@candlet.vn' },
  { name: 'Dương Minh Châu', email: 'minhchau.review@candlet.vn' },
  { name: 'Trịnh Tuấn Kiệt', email: 'tuankiet.review@candlet.vn' },
  { name: 'Tạ Thảo My', email: 'thaomy.review@candlet.vn' },
  { name: 'Lâm Khánh Vy', email: 'khanhvy.review@candlet.vn' },
  { name: 'Hà Nhật Nam', email: 'nhatnam.review@candlet.vn' },
  { name: 'Chu Bảo Ngọc', email: 'baongoc.review@candlet.vn' },
  { name: 'Vương Gia Linh', email: 'gialinh.review@candlet.vn' },
  { name: 'Trần Diệu Huyền', email: 'dieuhuyen.review@candlet.vn' },
  { name: 'Nguyễn Anh Khoa', email: 'anhkhoa.review@candlet.vn' },
  { name: 'Phùng Hải Đăng', email: 'haidang.review@candlet.vn' },
  { name: 'Lý Mai Phương', email: 'maiphuong.review@candlet.vn' },
  { name: 'Đoàn Bảo Trân', email: 'baotran.review@candlet.vn' },
  { name: 'Cao Minh Đức', email: 'minhduc.review@candlet.vn' },
  { name: 'Đinh Tố Uyên', email: 'touyen.review@candlet.vn' },
  { name: 'Mai Hoàng Long', email: 'hoanglong.review@candlet.vn' },
  { name: 'Hồ Kim Ngân', email: 'kimngan.review@candlet.vn' },
  { name: 'Lương Hoài An', email: 'hoaian.review@candlet.vn' },
  { name: 'Trương Đăng Khoa', email: 'dangkhoa.review@candlet.vn' },
];

// Kho đánh giá chuẩn 5 sao chạm cảm xúc, tập trung vào mùi hương, bấc gỗ, thông điệp ẩn & quà tặng
const EXCELLENT_5_STAR_REVIEWS = [
  {
    rating: 5,
    title: 'Mùi hương thanh tao, thư giãn vô cùng',
    content:
      'Mình đốt thử vào buổi tối lúc đọc sách, cảm giác phòng ấm cúng và dịu hẳn. Bấc nến cháy đều, mặt sáp đậu nành phẳng lì không hề bị thụt ngòi. Mùi tinh dầu rất tự nhiên, chắc chắn sẽ ủng hộ Candlet dài dài!',
  },
  {
    rating: 5,
    title: 'Quá đỗi bất ngờ với thông điệp ẩn bên trong!',
    content:
      'Cái cảm giác chờ nến cháy tan dần để thấy dòng chữ thông điệp ẩn giấu bên trong hồi hộp và ý nghĩa dã man. Người yêu mình nhận quà bất ngờ và thích mê ly. Cảm ơn shop rất nhiều vì một món quà tinh tế chạm tới trái tim!',
  },
  {
    rating: 5,
    title: 'Mùi thơm tự nhiên, không hề bị đau đầu',
    content:
      'Mình là người cực kỳ nhạy cảm với hương liệu công nghiệp, nhưng hũ nến này hoàn toàn là sáp thực vật và tinh dầu nguyên chất êm dịu, không gắt mũi tí nào. Đốt trước khi ngủ giúp mình thư thái và ngủ sâu giấc hơn hẳn.',
  },
  {
    rating: 5,
    title: 'Tiếng bấc gỗ tí tách nghe êm tai cực kỳ',
    content:
      'Bấc gỗ khi cháy phát ra tiếng lách tách nhỏ như than hồng trong lò sưởi mùa đông, cảm giác cực kỳ chill và xua tan mệt mỏi sau ngày dài làm việc. Hũ nến cầm nặng tay, thiết kế tối giản sang trọng.',
  },
  {
    rating: 5,
    title: 'Đóng gói siêu xinh, nến thơm tinh tế',
    content:
      'Shop đóng gói rất cẩn thận, có bọc chống sốc kỹ càng kèm theo que diêm dài và thiệp hướng dẫn chăm sóc nến rất chu đáo. Nến thơm ngát cả hộp khi vừa mở ra. Rất ưng bụng!',
  },
  {
    rating: 5,
    title: 'Mua làm quà tặng ai cũng khen nức nở',
    content:
      'Mình mua làm quà sinh nhật cho bạn thân, bạn ấy khen tấm tắc vì nến thơm thanh khiết và ý tưởng lời nhắn ẩn quá độc đáo. Một món quà chữa lành đầy cảm xúc!',
  },
  {
    rating: 5,
    title: 'Chiếc nến có gu nhất từ trước đến giờ',
    content:
      'Từ mùi hương cho đến chất lượng sáp đậu nành đều đỉnh chóp. Mặt sáp mịn như lụa, khi tắt dùng chuông dập nến không hề có khói đen ám phòng. Sẽ thử thêm các mùi hương khác của shop.',
  },
  {
    rating: 5,
    title: 'Tuyệt vời cho những tối thảnh thơi',
    content:
      'Bật chút nhạc lofi nhẹ nhàng, thắp ngọn nến thơm này lên là cả căn phòng trở thành không gian spa thu nhỏ. Mùi hương lưu luyến hồi lâu sau khi tắt nến. Xứng đáng điểm 10/10!',
  },
  {
    rating: 5,
    title: 'Độ tỏa hương ấn tượng, lan tỏa khắp phòng',
    content:
      'Phòng khách mình khoảng 30m2 mà chỉ cần đốt tầm 25 phút là mùi hương ấm áp đã lan tỏa khắp không gian. Hương thơm không quá nồng mà thoang thoảng, rất sang trọng và thư giãn.',
  },
  {
    rating: 5,
    title: 'Thông điệp ẩn làm mình xúc động rơi nước mắt',
    content:
      'Chồng mình tặng hũ nến này nhân dịp kỷ niệm ngày cưới, lúc sáp chảy ra hiện dòng chữ nhắn gửi yêu thương mà mình xúc động vô cùng. Một trải nghiệm quà tặng tuyệt vời mà không shop nào có được!',
  },
  {
    rating: 5,
    title: 'Sáp đậu nành cao cấp, đốt sạch hoàn toàn',
    content:
      'Sáp nến tan chảy đều đến tận viền cốc chứ không bị lõm ở giữa. Mùi hương thanh mát của cỏ cây hoa lá giúp tinh thần mình tập trung làm việc hiệu quả hơn hẳn.',
  },
  {
    rating: 5,
    title: 'Giao hàng siêu nhanh, đóng gói chỉn chu như tác phẩm nghệ thuật',
    content:
      'Đặt hôm trước hôm sau đã nhận được rồi. Mở hộp quà ra mà thấy trân trọng sự tỉ mỉ của shop, từng chiếc nơ hay lá khô trang trí đều đẹp lung linh. Rất đáng đồng tiền bát gạo!',
  },
  {
    rating: 5,
    title: 'Mùi hương xoa dịu tâm hồn những ngày mưa',
    content:
      'Trời mưa se lạnh ngồi bên tách trà nóng và ngắm ngọn nến lung linh tí tách thế này thì bình yên nào bằng. Mùi thơm ấm nồng lưu lại vương vấn suốt cả buổi tối.',
  },
  {
    rating: 5,
    title: 'Hũ gốm/thủy tinh tái sử dụng cực xinh',
    content:
      'Sau khi đốt hết sáp nến, mình rửa sạch hũ và dùng làm cốc cắm bút hoặc trồng sen đá nhỏ xinh trên bàn làm việc. Vừa bảo vệ môi trường vừa có đồ decor xinh xắn.',
  },
  {
    rating: 5,
    title: 'Sẽ tiếp tục ủng hộ Candlet nhiều lần nữa!',
    content:
      'Đây là hũ thứ 3 mình mua tại shop rồi. Cả gia đình ai cũng thích mùi hương tự nhiên này. Dịch vụ chăm sóc khách hàng của shop cực kỳ dễ thương và nhiệt tình.',
  }
];

async function seedHighRatingReviews() {
  try {
    console.log('🔄 Đang kết nối cơ sở dữ liệu MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Đã kết nối MongoDB thành công!');

    // 1. Tạo hoặc lấy danh sách tài khoản khách hàng giả lập
    console.log('👤 Đang đồng bộ danh sách tài khoản khách hàng đánh giá...');
    const userDocs = [];
    for (const u of FAKE_USERS) {
      let existingUser = await User.findOne({ email: u.email });
      if (!existingUser) {
        existingUser = await User.create({
          name: u.name,
          email: u.email,
          password: 'Password@123',
          role: 'customer',
          status: 'active',
        });
      }
      userDocs.push(existingUser);
    }
    console.log(`✅ Đã chuẩn bị ${userDocs.length} tài khoản khách hàng.`);

    // 2. Lấy danh sách sản phẩm
    const products = await Product.find({});
    console.log(`🕯️ Tìm thấy ${products.length} sản phẩm trong hệ thống.`);

    let totalNewCreated = 0;
    const reportList = [];

    for (let i = 0; i < products.length; i++) {
      const prod = products[i];
      const existingReviews = await Review.find({ product: prod._id });
      const currentCount = existingReviews.length;
      const currentSum = existingReviews.reduce((acc, r) => acc + (r.rating || 5), 0);
      const currentAvg = currentCount > 0 ? (currentSum / currentCount).toFixed(2) : 0;

      // Tính số đánh giá 5 sao cần thêm để:
      // (currentSum + 5 * k) / (currentCount + k) >= 4.92
      // => k * (5 - 4.92) >= 4.92 * currentCount - currentSum
      // => 0.08 * k >= 4.92 * currentCount - currentSum
      // => k >= (4.92 * currentCount - currentSum) / 0.08
      let kNeededForRating = 0;
      if (currentCount > 0) {
        const diff = 4.92 * currentCount - currentSum;
        if (diff > 0) {
          kNeededForRating = Math.ceil(diff / 0.08);
        }
      }

      // Đảm bảo mỗi sản phẩm có tối thiểu từ 6 đến 9 đánh giá tổng cộng
      const targetMinReviews = Math.floor(Math.random() * 4) + 6; // 6, 7, 8 hoặc 9 đánh giá
      const countNeeded = Math.max(0, targetMinReviews - currentCount);

      // Số lượng review 5 sao cần thêm vào sản phẩm này
      const reviewsToAdd = Math.max(kNeededForRating, countNeeded, 3); // Ít nhất thêm 3 review 5 sao chất lượng cao

      // Chuẩn bị biến thể hiển thị chân thực
      const variantOptions = [];
      if (prod.volume) variantOptions.push(`Dung tích: ${prod.volume}`);
      if (prod.skus && prod.skus.length > 0) {
        prod.skus.forEach((sku) => {
          if (sku.combination && sku.combination.length > 0) {
            variantOptions.push(sku.combination.join(' - '));
          }
        });
      }
      if (variantOptions.length === 0) {
        variantOptions.push('Hũ tiêu chuẩn 200g - Bấc gỗ tự nhiên', 'Hộp quà cao cấp - Sáp đậu nành', 'Bấc cotton hữu cơ - 250g');
      }

      // Chọn người dùng chưa từng review sản phẩm này nếu có thể
      const existingUserIds = new Set(existingReviews.map(r => r.user.toString()));
      const availableUsers = userDocs.filter(u => !existingUserIds.has(u._id.toString()));
      const shuffledUsers = (availableUsers.length >= reviewsToAdd ? availableUsers : userDocs)
        .sort(() => 0.5 - Math.random());

      const shuffledTemplates = [...EXCELLENT_5_STAR_REVIEWS].sort(() => 0.5 - Math.random());

      for (let j = 0; j < reviewsToAdd; j++) {
        const template = shuffledTemplates[j % shuffledTemplates.length];
        const reviewer = shuffledUsers[j % shuffledUsers.length];
        const variantText = variantOptions[j % variantOptions.length] || 'Hũ tiêu chuẩn 200g';

        // Tạo ngày ngẫu nhiên trong vòng 50 ngày qua
        const daysAgo = Math.floor(Math.random() * 50) + 1;
        const reviewDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

        let customContent = template.content;
        if (j === 0 && prod.name) {
          customContent = `Mình chọn hũ "${prod.name}" này và thực sự ưng ý từ mùi hương đến thông điệp ẩn. ` + template.content;
        }

        await Review.create({
          product: prod._id,
          user: reviewer._id,
          rating: 5, // 100% đánh giá mới là 5 sao để bảo đảm trung bình > 4.9
          title: template.title,
          content: customContent,
          variant: variantText,
          verified: true,
          createdAt: reviewDate,
          updatedAt: reviewDate,
        });

        totalNewCreated++;
      }

      // Tính lại điểm sau khi thêm
      const finalReviews = await Review.find({ product: prod._id });
      const finalCount = finalReviews.length;
      const finalSum = finalReviews.reduce((acc, r) => acc + (r.rating || 5), 0);
      const finalAvg = (finalSum / finalCount).toFixed(1);
      const exactAvg = (finalSum / finalCount).toFixed(3);

      reportList.push({
        name: prod.name,
        oldCount: currentCount,
        added: reviewsToAdd,
        totalReviews: finalCount,
        exactAvg,
        displayAvg: finalAvg,
        pass: Number(finalAvg) >= 4.9,
      });
    }

    console.log('\n================================================================');
    console.log('📊 BÁO CÁO THỐNG KÊ ĐIỂM SAO ĐÁNH GIÁ CÁC SẢN PHẨM:');
    console.log('================================================================');
    reportList.forEach((item, idx) => {
      const statusIcon = item.pass ? '✅' : '⚠️';
      console.log(
        `${idx + 1}. [${statusIcon}] "${item.name}": ${item.totalReviews} đánh giá | Điểm hiển thị: ${item.displayAvg}⭐ (Chính xác: ${item.exactAvg})`
      );
    });
    console.log('================================================================');
    console.log(`🎉 ĐÃ HOÀN TẤT! Tạo mới thành công ${totalNewCreated} đánh giá 5 sao.`);
    console.log(`✨ 100% sản phẩm hiện tại đều đạt điểm trung bình hiển thị >= 4.9⭐!`);
    console.log('================================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi trong quá trình tạo đánh giá:', error);
    process.exit(1);
  }
}

seedHighRatingReviews();
