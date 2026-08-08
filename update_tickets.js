const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const ImportTicket = require('./models/ImportTicket');
  
  const result = await ImportTicket.updateMany(
    { payment_status: { $exists: false } },
    { $set: { payment_status: 'unsettled' } }
  );
  
  console.log(`Updated ${result.modifiedCount} tickets to unsettled.`);
  mongoose.disconnect();
});
