const mongoose = require('mongoose');
require('dotenv').config();
const Material = require('./models/Material');
const Product = require('./models/Product');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/candletsales');
  const allProducts = await Product.find().populate('base_ingredients.ingredient_id').populate('skus.extra_ingredients.ingredient_id');
  
  const shopeeName = "SH_SET - Nến Thơm Thủ Công CANDLET Soft Healing 150g – Nến Thơm Cao Cấp, Decor Phòng, Quà Tặng Sinh Nhật, Hương Hoa Mềm Mại";
  const shopeeSku = "Set Quà Tặng";
  const shopeeSkuCode = "";
  
  let matchedProduct = null;
  let matchedSkuId = null;

  const shopeeFullTextUpper = (shopeeName + ' ' + shopeeSku + ' ' + shopeeSkuCode).toUpperCase();
  const allIdentifiers = [];
  
  for (const p of allProducts) {
    if (p.skus && p.skus.length > 0) {
      for (const s of p.skus) {
        if (s.id) {
          allIdentifiers.push({ type: 'sku', id: s.id.toUpperCase(), skuId: s.id, product: p });
        }
      }
    }
    if (p.productId) {
      allIdentifiers.push({ type: 'product', id: p.productId.toUpperCase(), product: p });
    }
  }
  
  allIdentifiers.sort((a, b) => b.id.length - a.id.length);
  
  for (const identifier of allIdentifiers) {
    if (shopeeFullTextUpper.includes(identifier.id)) {
      matchedProduct = identifier.product;
      if (identifier.type === 'sku') {
        matchedSkuId = identifier.skuId;
      }
      break;
    }
  }
  
  console.log("Matched Product (Step 2):", matchedProduct ? matchedProduct.productId : "None");
  console.log("Matched SKU (Step 2):", matchedSkuId);

  if (!matchedProduct) {
    const shopeeFullTextLower = (shopeeName + ' ' + shopeeSku).toLowerCase();
    for (const p of allProducts) {
      if (shopeeFullTextLower.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(shopeeName.toLowerCase())) {
        matchedProduct = p;
        break;
      }
    }
    console.log("Matched Product (Step 3):", matchedProduct ? matchedProduct.productId : "None");
  }

  if (matchedProduct && !matchedSkuId && matchedProduct.skus && matchedProduct.skus.length > 0) {
    const variationDetailUpper = shopeeSku.toUpperCase();
    const variationDetailLower = shopeeSku.toLowerCase();
    
    // 4a
    const sortedProductSkus = [...matchedProduct.skus].sort((a, b) => (b.id?.length || 0) - (a.id?.length || 0));
    for (const s of sortedProductSkus) {
      if (s.id && variationDetailUpper.includes(s.id.toUpperCase())) {
        matchedSkuId = s.id;
        console.log("Matched SKU (4a):", matchedSkuId);
        break;
      }
    }
    
    // 4b
    if (!matchedSkuId) {
      for (const s of matchedProduct.skus) {
        let skuLabels = [];
        if (s.combination) {
          for (const optId of s.combination) {
            for (const vg of (matchedProduct.variant_groups || [])) {
              const opt = (vg.options || []).find(o => o.id === optId);
              if (opt && opt.label) {
                skuLabels.push(opt.label.toLowerCase());
                console.log(`Extracted label for ${optId}:`, opt.label.toLowerCase());
              }
            }
          }
        }
        
        if (skuLabels.length > 0) {
          console.log(`Checking SKU ${s.id} with labels:`, skuLabels, `against: "${variationDetailLower}"`);
          const allLabelsMatch = skuLabels.every(lbl => variationDetailLower.includes(lbl));
          if (allLabelsMatch) {
            matchedSkuId = s.id;
            console.log("Matched SKU (4b):", matchedSkuId);
            break;
          }
        }
      }
    }
  }

  console.log("FINAL MATCHED SKU:", matchedSkuId);
  if (matchedProduct && matchedSkuId) {
    const sku = matchedProduct.skus.find(s => s.id === matchedSkuId);
    console.log("SKU found in product:", !!sku);
    if (sku) {
      console.log("Extra ingredients count:", sku.extra_ingredients ? sku.extra_ingredients.length : 0);
      console.log("Extra ingredients:", JSON.stringify(sku.extra_ingredients, null, 2));
    }
  }

  process.exit(0);
}

test().catch(console.error);
