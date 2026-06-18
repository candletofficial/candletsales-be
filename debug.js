const mongoose = require('mongoose');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const { fetchDashboardData } = require('./controllers/aiController'); // Need to export fetchDashboardData first or just copy it

// I'll copy the fetchDashboardData logic to test it.
const Order = require('./models/Order');
const Material = require('./models/Material');
const AdCost = require('./models/AdCost');
const ImportTicket = require('./models/ImportTicket');
const InventoryCheck = require('./models/InventoryCheck');
const FundTransaction = require('./models/FundTransaction');
const { buildSmartAlertsPrompt } = require('./utils/aiHelper');

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    const { fetchDashboardData } = require('./controllers/aiController');
    const dashboardData = await fetchDashboardData();
    console.log('fetchDashboardData success!');

    
    const prompt = buildSmartAlertsPrompt(dashboardData);
    console.log('Prompt built, calling Gemini...');
    
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    console.log('Response:', response.text);
    process.exit(0);
  } catch (error) {
    console.error('ERROR CATCHED:', error);
    process.exit(1);
  }
};

run();
