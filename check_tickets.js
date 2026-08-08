const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const ImportTicket = require('./models/ImportTicket');
  
  const allTickets = await ImportTicket.find().lean();
  let missingPaymentStatusCount = 0;
  let missingPaymentStatusTotal = 0;
  
  allTickets.forEach(t => {
    if (t.payment_status === undefined) {
      missingPaymentStatusCount++;
      missingPaymentStatusTotal += t.total_amount;
      console.log(`Missing payment_status: ${t.code} - ${t.total_amount}`);
    }
  });
  
  console.log(`\nTotal tickets missing payment_status: ${missingPaymentStatusCount}`);
  console.log(`Total amount missing: ${missingPaymentStatusTotal}`);
  
  mongoose.disconnect();
});
