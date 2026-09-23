/**
 * Script tự động fake các bài viết mẫu chất lượng cao cho trang Câu Chuyện
 * Chạy lệnh: node scripts/seedPosts.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Post = require('../models/Post');

const SAMPLE_POSTS = [
  {
    title: 'Liệu Pháp Mùi Hương: Khi Khói Nến Vỗ Về Những Tổn Thương Tâm Trí',
    slug: 'lieu-phap-mui-huong-khi-khoi-nen-vo-ve-nhung-ton-thuong-tam-tri',
    summary:
      'Trong nhịp sống xô bồ, một đốm lửa nhỏ cùng hương thơm mộc mạc từ thảo mộc thiên nhiên có thể mở ra cánh cửa dẫn lối tâm hồn về lại chốn bình yên nguyên sơ nhất.',
    category: 'Chữa Lành & Cảm Xúc',
    author: 'Nghệ nhân Thảo Mộc',
    readTime: '6 phút đọc',
    thumbnail: 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=1200&q=80',
    customDesign: {
      themeColor: '#4A2C2A',
      fontStyle: 'serif',
      layoutStyle: 'editorial',
      quoteHighlight: 'Mùi hương không tác động vào lý trí, nó chạm thẳng vào trái tim và đánh thức những ký ức an yên nhất.',
    },
    content: `
<h2>1. Khứu giác – Chiếc cầu nối trực tiếp đến miền ký ức</h2>
<p>Bạn có bao giờ bất chợt ngửi thấy một mùi hương quen thuộc trên góc phố và bỗng thấy lòng mình chùng xuống, nhớ về một buổi chiều mùa thu năm nào bên tách trà nóng? Khác với thị giác hay thính giác phải qua nhiều trạm xử lý thông tin của vỏ não, tế bào khứu giác gửi tín hiệu thẳng tới <strong>Hệ viền (Limbic System)</strong> – trung tâm điều khiển cảm xúc và ký ức của con người.</p>

<p>Đó chính là lý do vì sao một hũ nến thơm mang nốt hương gỗ đàn hương hay tuyết tùng trầm ấm có thể khiến hơi thở của bạn chậm lại ngay tức khắc sau 10 tiếng mệt nhoài nơi công sở.</p>

<blockquote>
"Khi châm ngọn nến lên, bạn không chỉ thắp sáng một căn phòng, bạn đang đánh dấu ranh giới thiêng liêng giữa áp lực ngoài kia và sự bình yên bên trong tâm trí mình."
</blockquote>

<h2>2. Bấc gỗ tí tách – Bản giao hưởng của sự tĩnh lặng</h2>
<p>Tại Candlet, chúng tôi chọn bấc gỗ tự nhiên thay vì bấc cotton công nghiệp. Tiếng lách tách khe khẽ như cành cây khô reo vui trong lò sưởi mùa đông không chỉ là một trải nghiệm thính giác mộc mạc, mà còn là một dạng <em>White Noise (Tiếng ồn trắng)</em> giúp xoa dịu những sóng não căng thẳng.</p>

<p>Hãy thử đặt điện thoại sang chế độ im lặng, ngồi tựa lưng vào chiếc gối êm và nhắm mắt lại. Để từng làn hương oải hương hòa quyện cùng cỏ hương bài từ từ len lỏi vào từng tế bào, bạn sẽ nhận ra bình yên chưa bao giờ là điều gì quá xa xôi.</p>

<h2>3. Nghi thức nhỏ cho một buổi tối chữa lành trọn vẹn</h2>
<ul>
  <li><strong>Bước 1:</strong> Dọn dẹp sơ góc bàn hoặc chiếc giường ngủ của bạn. Sự gọn gàng về không gian mở đường cho sự thoáng đãng của tâm trí.</li>
  <li><strong>Bước 2:</strong> Châm nến bằng một que diêm dài cổ điển, ngắm nhìn ngọn lửa non nớt lớn dần.</li>
  <li><strong>Bước 3:</strong> Hít sâu bằng mũi trong 4 giây, giữ lại 4 giây và thở nhẹ ra trong 6 giây. Lặp lại 5 lần cùng làn hương thanh khiết.</li>
</ul>
<p>Chúc bạn tìm thấy những phút giây tĩnh lặng và ấm áp nhất bên ngọn nến của chính mình.</p>
    `,
    isPublished: true,
    viewCount: 142,
    likesCount: 38,
  },
  {
    title: 'Sự Thật Về Sáp Đậu Nành & Vì Sao Candlet Nói Không Với Parafin Công Nghiệp',
    slug: 'su-that-ve-sap-dau-nanh-va-vi-sao-candlet-noi-khong-voi-parafin',
    summary:
      'Không phải ngọn nến nào cũng lành tính. Khám phá sự khác biệt cốt lõi giữa sáp thực vật hữu cơ và sáp dầu mỏ công nghiệp đối với sức khỏe hệ hô hấp của gia đình bạn.',
    category: 'Hậu Trường Chế Tác',
    author: 'Candlet Studio',
    readTime: '5 phút đọc',
    thumbnail: 'https://images.unsplash.com/photo-1572726729207-a78d6feb18d7?auto=format&fit=crop&w=1200&q=80',
    customDesign: {
      themeColor: '#2D4A3E',
      fontStyle: 'sans',
      layoutStyle: 'standard',
      quoteHighlight: 'Sự xa xỉ đích thực của một hũ nến không nằm ở chiếc vỏ hào nhoáng, mà nằm ở sự thuần khiết tuyệt đối của dòng sáp nuôi dưỡng lá phổi bạn.',
    },
    content: `
<h2>1. Nến thơm giá rẻ và những nguy cơ tiềm ẩn từ dầu mỏ</h2>
<p>Phần lớn các loại nến công nghiệp trôi nổi trên thị trường hiện nay được làm từ <strong>Parafin</strong> – một sản phẩm phụ thải ra trong quá trình tinh chế dầu mỏ. Để tạo màu sắc bắt mắt và mùi hương nồng nặc giá rẻ, người ta buộc phải pha thêm các hợp chất hóa học nhân tạo.</p>

<p>Khi cháy, sáp parafin giải phóng ra các hạt bồ hóng siêu mịn cùng các hợp chất hữu cơ dễ bay hơi (VOCs) như benzen và toluen – hai chất được chứng minh có thể gây kích ứng niêm mạc, đau đầu và ảnh hưởng xấu đến đường thở nếu đốt trong phòng kín.</p>

<blockquote>
"Sự lựa chọn nguyên liệu không chỉ là triết lý sản phẩm, đó là trách nhiệm đạo đức đối với sức khỏe của từng khách hàng tin chọn Candlet."
</blockquote>

<h2>2. Sáp đậu nành (Soy Wax) – Món quà thuần khiết từ lòng đất mẹ</h2>
<p>Tại xưởng Candlet, 100% phôi nến được làm từ <strong>sáp đậu nành hữu cơ ép lạnh</strong> kết hợp sáp ong tinh khiết:</p>
<ul>
  <li><strong>Nhiệt độ nóng chảy thấp:</strong> Sáp đậu nành tan chảy ở mức nhiệt mát lành khoảng 45 - 50°C, giúp tinh dầu thiên nhiên không bị cháy khét và bảo toàn được trọn vẹn đặc tính trị liệu.</li>
  <li><strong>Cháy sạch và không sinh khói đen:</strong> Ngọn lửa đậu nành cháy êm ả, sạch sẽ, hoàn toàn không ám vết đen lên tường hay trần nhà.</li>
  <li><strong>Thời gian cháy lâu hơn 50%:</strong> Nhờ mật độ phân tử đậm đặc và tốc độ cháy chậm, một hũ nến 200g từ sáp đậu nành có thể thắp sáng bền bỉ suốt 45 đến 50 giờ.</li>
  <li><strong>Dễ dàng vệ sinh:</strong> Nếu chẳng may sáp rớt ra mặt bàn gỗ hay khăn trải bàn, bạn chỉ cần dùng khăn thấm nước ấm pha chút xà phòng là có thể lau sạch tinh tươm.</li>
</ul>

<h2>3. Nhận diện nến sáp đậu nành nguyên chất qua mắt thường</h2>
<p>Sau khi đốt xong và để nguội tự nhiên, bạn có thể thấy bề mặt nến hơi nhăn nhẹ hoặc nổi những vân sáp lụa li ti. Đừng lo lắng! Đó chính là "chứng chỉ vàng" cho thấy hũ nến của bạn hoàn toàn 100% từ thực vật tự nhiên, không hề pha tạp hóa chất làm mịn nhân tạo.</p>
    `,
    isPublished: true,
    viewCount: 98,
    likesCount: 24,
  },
  {
    title: 'Nghệ Thuật Đọc Sách Bên Ánh Lửa: Xây Dựng Góc Bình Yên Riêng Cho Bạn',
    slug: 'nghe-thuat-doc-sach-ben-anh-lua-xay-dung-goc-binh-yen-cho-ban',
    summary:
      'Một cuốn sách hay, một tách trà thơm và một hũ nến tí tách – đó là chiếc kén ấm áp bảo vệ bạn khỏi sự ồn ào vội vã của thế giới hiện đại.',
    category: 'Phong Cách Sống & Không Gian',
    author: 'Mai Phương - Sáng lập Candlet',
    readTime: '4 phút đọc',
    thumbnail: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=1200&q=80',
    customDesign: {
      themeColor: '#8C4A32',
      fontStyle: 'serif',
      layoutStyle: 'editorial',
      quoteHighlight: 'Những trang sách mở ra thế giới, còn ngọn nến đưa bạn trở về với chính ngôi nhà bên trong tâm hồn mình.',
    },
    content: `
<h2>1. Chiếc kén bình yên sau cánh cửa nhà</h2>
<p>Giữa thời đại mà mắt chúng ta luôn phải dán chặt vào màn hình xanh từ 8 giờ sáng đến tận nửa đêm, khoảnh khắc tắt đi những thông báo công việc, lật từng trang giấy thơm mùi mực in chính là một liệu pháp phục hồi năng lượng kỳ diệu.</p>

<p>Ánh sáng vàng ấm từ ngọn nến (khoảng 1800K) có quang phổ dịu nhẹ tương tự ánh hoàng hôn tự nhiên, gửi tín hiệu đến tuyến tùng để tiết ra melatonin – hormone chuẩn bị cho cơ thể bước vào giấc ngủ sâu và thanh thản.</p>

<blockquote>
"Hạnh phúc đôi khi không phải là đi thật xa, mà là tìm thấy một góc nhỏ đủ bình yên để trút bỏ mọi lớp áo giáp phòng thủ của ban ngày."
</blockquote>

<h2>2. Gợi ý nốt hương nến phù hợp cho từng thể loại sách</h2>
<ul>
  <li><strong>Văn học cổ điển & Tiểu thuyết lịch sử:</strong> Hãy chọn nến tone <em>Gỗ Đàn Hương & Hổ Phách</em>. Vị trầm mặc cổ kính sẽ đưa bạn đồng hành cùng những nhân vật qua bao thế kỷ thăng trầm.</li>
  <li><strong>Sách phát triển bản thân & Triết học:</strong> Nốt hương <em>Trà Trắng & Xô Thơm (White Tea & Sage)</em> thanh tao, tĩnh tại giúp đầu óc sáng rõ, tập trung và minh triết.</li>
  <li><strong>Thơ ca & Tản văn lãng mạn:</strong> Hương <em>Oải hương Provence & Vani ngọt ấm</em> nhẹ nhàng như một cái ôm vỗ về những xúc cảm dịu dàng nhất.</li>
</ul>

<h2>3. Lời nhắn nhủ nhỏ</h2>
<p>Hãy tạo cho mình một góc nhỏ cố định: một chiếc ghế bành êm, một tấm chăn dệt kim ấm áp và hũ nến thân quen. Dù ngoài kia giông bão hay mỏi mệt, bạn biết rằng luôn có một ngọn lửa nhỏ đang kiên nhẫn đợi bạn trở về.</p>
    `,
    isPublished: true,
    viewCount: 215,
    likesCount: 62,
  },
  {
    title: 'Khám Phá Các Tầng Hương: Bí Mật Để Giữ Hương Thơm Suốt Cả Ngày Dài',
    slug: 'kham-pha-cac-tang-huong-bi-mat-de-giu-huong-thom-suot-ngay-dai',
    summary:
      'Tương tự như nước hoa cao cấp, một hũ nến thơm nghệ thuật được cấu thành từ 3 tầng hương tinh tế: Hương đầu bay bổng, Hương giữa nồng nàn và Hương cuối lắng đọng.',
    category: 'Nghệ Thuật Mùi Hương',
    author: 'Chuyên gia Mùi Hương Candlet',
    readTime: '7 phút đọc',
    thumbnail: 'https://images.unsplash.com/photo-1547887537-6158d64c35b3?auto=format&fit=crop&w=1200&q=80',
    customDesign: {
      themeColor: '#B45309',
      fontStyle: 'serif',
      layoutStyle: 'standard',
      quoteHighlight: 'Mùi hương không đứng yên, nó là một vở kịch biến chuyển kỳ diệu theo từng phút ngọn lửa thiêu đốt sáp.',
    },
    content: `
<h2>1. Kim tự tháp mùi hương – Bản thiết kế của sự quyến rũ</h2>
<p>Khi cầm hũ nến lên ngửi lúc chưa đốt, bạn chỉ mới tiếp xúc với khoảng 20% câu chuyện mùi hương mà nghệ nhân muốn kể. Một tác phẩm nến chuẩn mực được phối trộn theo nguyên lý kim tự tháp 3 tầng:</p>

<ul>
  <li><strong>Hương đầu (Top Notes):</strong> Là ấn tượng đầu tiên khi mở nắp hoặc trong 15 phút đầu châm lửa. Thường là các phân tử hương nhẹ và dễ bay hơi như <em>Cam Bergamot, Quýt Clementine, Chanh vàng, Bạc hà</em>. Tầng hương này mang lại cảm giác sảng khoái và tươi mới bất ngờ.</li>
  <li><strong>Hương giữa (Heart/Middle Notes):</strong> Chiếm tới 70% linh hồn của hũ nến, bắt đầu tỏa hương rõ rệt sau 20 - 45 phút khi hồ sáp đã tan đều. Thường là các nốt hoa thanh nhã như <em>Nhài Sambac, Hoa Hồng Tháng Năm, Phong Lữ, Oải Hương</em>. Đây là giai đoạn mùi hương đạt độ tròn trịa và êm ái nhất.</li>
  <li><strong>Hương cuối (Base Notes):</strong> Những phân tử hương nặng và bền bỉ nhất, neo đậu sâu dưới đáy cốc và lưu lại trong phòng suốt nhiều giờ sau khi nến đã tắt. Đó là <em>Gỗ Tuyết Tùng, Hoắc Hương, Xạ Hương Thực Vật, Vani Madagascar và Hổ Phách</em>.</li>
</ul>

<blockquote>
"Một hũ nến đơn điệu chỉ có một mùi duy nhất từ đầu đến cuối. Một hũ nến nghệ thuật là một cuộc du hành khứu giác bất tận."
</blockquote>

<h2>2. Cách tối ưu hóa độ tỏa hương trong phòng kín</h2>
<p>Để nến thơm phát huy tối đa 100% công năng tỏa hương (Scent Throw), bạn nên lưu ý 3 mẹo đơn giản sau:</p>
<ol>
  <li><strong>Đóng kín cửa trong 20 phút đầu:</strong> Giúp các phân tử hương nhanh chóng bão hòa trong không gian phòng trước khi mở hé cửa sổ để đối lưu không khí.</li>
  <li><strong>Vị trí đặt nến:</strong> Nên đặt nến ở độ cao khoảng ngang tầm ngực hoặc thắt lưng (trên bàn làm việc, kệ sách), tránh đặt quá cao sát trần nhà vì không khí ấm mang mùi hương sẽ bốc lên trên.</li>
  <li><strong>Tắt điều hòa gió mạnh:</strong> Gió thổi trực tiếp từ máy lạnh sẽ thổi bạt làn khói thơm ra ngoài và làm ngọn lửa cháy không đều.</li>
</ol>
    `,
    isPublished: true,
    viewCount: 189,
    likesCount: 51,
  },
];

async function seedPosts() {
  try {
    console.log('🔄 Đang kết nối cơ sở dữ liệu MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Đã kết nối MongoDB thành công!');

    console.log('📝 Đang đồng bộ danh sách bài viết câu chuyện...');
    let createdCount = 0;
    let updatedCount = 0;

    for (const postData of SAMPLE_POSTS) {
      let existingPost = await Post.findOne({ slug: postData.slug });
      if (!existingPost) {
        await Post.create(postData);
        createdCount++;
        console.log(`  + Đã tạo bài viết: "${postData.title}" (${postData.category})`);
      } else {
        // Cập nhật lượt xem và tim nếu chưa có hoặc bằng 0
        existingPost.likesCount = postData.likesCount;
        existingPost.viewCount = Math.max(existingPost.viewCount || 0, postData.viewCount);
        await existingPost.save();
        updatedCount++;
        console.log(`  -> Đã cập nhật tương tác cho bài: "${postData.title}" (Views: ${existingPost.viewCount}, Likes: ${existingPost.likesCount})`);
      }
    }

    console.log('\n=============================================');
    console.log(`🎉 HOÀN TẤT! Tạo mới: ${createdCount}, Cập nhật tương tác: ${updatedCount}.`);
    console.log('✨ Số liệu lượt xem và lượt tim thực tế đã sẵn sàng trên Database.');
    console.log('=============================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi trong quá trình seed bài viết:', error);
    process.exit(1);
  }
}
seedPosts();
